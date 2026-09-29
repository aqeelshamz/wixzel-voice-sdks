/**
 * The transport: one fetch wrapper that every resource method goes through.
 *
 * It knows the API's conventions so callers do not have to: the bearer
 * header, the optional version pin, cursor pagination, the idempotency key
 * on the paths that spend money, `Retry-After` on a 429, and the error
 * envelope. Nothing here is specific to a resource.
 */

import { WixzelConnectionError, WixzelError } from './error.js';
import { Page } from './page.js';
import { attachResponse, metaFrom } from './response.js';
import type { ApiErrorBody, ListResponse } from '../types.js';
import { CLIENT_HEADER, USER_AGENT } from '../version.js';

export const DEFAULT_BASE_URL = 'https://api.voice.wixzel.com';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

/** Options accepted by every method, as the last argument. */
export interface RequestOptions {
    /**
     * The `Idempotency-Key` to send. Only meaningful on the money paths
     * (`calls.create`, `billing.createTopup`), where one is generated when
     * omitted. Reuse the SAME key when retrying the SAME logical request.
     */
    idempotencyKey?: string;
    /** Abort the request from outside. Aborting never triggers a retry. */
    signal?: AbortSignal;
    /** Extra headers for this request only. */
    headers?: Record<string, string>;
    /** Override the client's retry budget for this request. */
    maxRetries?: number;
}

export interface HttpOptions {
    apiKey: string;
    baseUrl?: string | undefined;
    apiVersion?: string | undefined;
    timeoutMs?: number | undefined;
    maxRetries?: number | undefined;
    fetch?: typeof fetch | undefined;
    defaultHeaders?: Record<string, string> | undefined;
    /** Injected in tests so retries do not actually wait. */
    sleep?: ((ms: number) => Promise<void>) | undefined;
}

interface SendInit extends RequestOptions {
    query?: Query | undefined;
    body?: unknown;
    /** Marks a request that must carry an Idempotency-Key. */
    idempotent?: boolean | undefined;
}

const MAX_IDEMPOTENCY_KEY = 255;
const RETRY_AFTER_CAP_MS = 10_000;

export class Http {
    readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly apiVersion: string | undefined;
    private readonly timeoutMs: number;
    private readonly maxRetries: number;
    private readonly fetchImpl: typeof fetch;
    private readonly defaultHeaders: Record<string, string>;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(opts: HttpOptions) {
        if (!opts.apiKey) throw new TypeError('wixzel-voice: apiKey is required');
        this.apiKey = opts.apiKey;
        this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
        this.apiVersion = opts.apiVersion;
        this.timeoutMs = opts.timeoutMs ?? 30_000;
        this.maxRetries = opts.maxRetries ?? 2;
        this.fetchImpl = opts.fetch ?? globalThis.fetch;
        this.defaultHeaders = opts.defaultHeaders ?? {};
        this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        if (typeof this.fetchImpl !== 'function') {
            throw new TypeError('wixzel-voice: no fetch available; pass one in the options');
        }
    }

    get keyMode(): 'live' | 'test' | 'unknown' {
        if (this.apiKey.startsWith('wv_live_')) return 'live';
        if (this.apiKey.startsWith('wv_test_')) return 'test';
        return 'unknown';
    }

    /** A cursor-paginated list. The query is kept so later pages match the first. */
    async list<T>(path: string, query: Query = {}, opts: RequestOptions = {}): Promise<Page<T>> {
        const fetchPage = async (cursor?: string): Promise<Page<T>> => {
            const q: Query = { ...query };
            if (cursor !== undefined) {
                delete q.ending_before;
                q.starting_after = cursor;
            }
            const body = await this.request<ListResponse<T>>('GET', path, { ...opts, query: q });
            return new Page<T>(body, (next) => fetchPage(next));
        };
        return fetchPage();
    }

    async request<T>(method: HttpMethod, path: string, init: SendInit = {}): Promise<T> {
        const url = new URL(this.baseUrl + path);
        for (const [key, value] of Object.entries(init.query ?? {})) {
            if (value === undefined || value === null || value === '') continue;
            url.searchParams.set(key, String(value));
        }

        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
            'X-Wixzel-Client': CLIENT_HEADER,
            ...this.defaultHeaders,
            ...(init.headers ?? {}),
        };
        if (this.apiVersion) headers['Wixzel-Version'] = this.apiVersion;
        if (init.body !== undefined) headers['Content-Type'] = 'application/json';

        // Decided once, before the loop: every retry of this call reuses it,
        // which is the whole point of the key.
        const idempotencyKey = init.idempotencyKey ?? (init.idempotent ? globalThis.crypto.randomUUID() : undefined);
        if (idempotencyKey !== undefined) {
            if (idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
                throw new TypeError(`wixzel-voice: idempotencyKey must be 1–${MAX_IDEMPOTENCY_KEY} characters`);
            }
            headers['Idempotency-Key'] = idempotencyKey;
        }

        // Safe to repeat: a read, or anything the server can dedupe by key.
        const repeatable = method === 'GET' || idempotencyKey !== undefined;
        const maxRetries = init.maxRetries ?? this.maxRetries;
        const body = init.body === undefined ? undefined : JSON.stringify(init.body);

        for (let attempt = 0; ; attempt++) {
            let response: Response;
            try {
                response = await this.fetchImpl(url, {
                    method,
                    headers,
                    ...(body === undefined ? {} : { body }),
                    signal: this.signalFor(init.signal),
                });
            } catch (error) {
                if (init.signal?.aborted) throw error;
                if (repeatable && attempt < maxRetries) {
                    await this.sleep(backoff(attempt));
                    continue;
                }
                throw new WixzelConnectionError(
                    `wixzel-voice: ${method} ${path} failed after ${attempt + 1} attempt(s): ${(error as Error).message}`,
                    error,
                );
            }

            if (response.status === 429 && attempt < maxRetries) {
                await this.sleep(retryAfterMs(response) ?? backoff(attempt));
                continue;
            }
            if (isTransient(response.status) && repeatable && attempt < maxRetries) {
                await this.sleep(retryAfterMs(response) ?? backoff(attempt));
                continue;
            }

            if (response.status === 204) return undefined as T;

            const text = await response.text();
            let parsed: unknown = null;
            if (text) {
                try {
                    parsed = JSON.parse(text);
                } catch {
                    parsed = null;
                }
            }

            if (!response.ok) {
                const errorBody =
                    parsed !== null && typeof parsed === 'object' && 'error' in parsed
                        ? ((parsed as { error: Partial<ApiErrorBody> }).error ?? {})
                        : { message: text || response.statusText };
                throw new WixzelError(response.status, errorBody, response.headers);
            }

            return attachResponse((parsed ?? text) as T, metaFrom(response));
        }
    }

    /** Our timeout, wired to the caller's signal if there is one. No AbortSignal.any: Node 20.0 lacks it. */
    private signalFor(outer: AbortSignal | undefined): AbortSignal {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error(`timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
        const clear = () => clearTimeout(timer);
        controller.signal.addEventListener('abort', clear, { once: true });
        if (outer) {
            if (outer.aborted) controller.abort(outer.reason);
            else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
        }
        return controller.signal;
    }
}

function isTransient(status: number): boolean {
    return status === 502 || status === 503 || status === 504;
}

function retryAfterMs(response: Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (header === null) return undefined;
    const seconds = Number(header);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}

/** 500 ms, 1 s, 2 s, … capped at 8 s, with ±25 % jitter so a fleet does not retry in lockstep. */
function backoff(attempt: number): number {
    const base = Math.min(500 * 2 ** attempt, 8_000);
    return Math.round(base * (0.75 + Math.random() * 0.5));
}
