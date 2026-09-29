/**
 * A small HTTP client for the Wixzel Voice API.
 *
 * Deliberately dependency-free: `fetch` is built into Node 20+, and the API's
 * conventions (bearer key, JSON, structured errors with a request_id, cursor
 * pagination, Idempotency-Key on money paths) are simple enough that a wrapper
 * around fetch is the whole client.
 */

import { randomUUID } from 'node:crypto';
import { VERSION } from './version.js';

/**
 * api.phone.wixzel.com, the default before 0.4.0, keeps serving the same API,
 * so older releases of this package keep working.
 */
export const DEFAULT_BASE_URL = 'https://api.voice.wixzel.com';
export const USER_AGENT = `wixzel-voice-mcp/${VERSION}`;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
    query?: Record<string, QueryValue>;
    body?: unknown;
    /** Sent as `Idempotency-Key`. Generated when `idempotent` is true and none is given. */
    idempotencyKey?: string;
    idempotent?: boolean;
}

export interface WixzelErrorBody {
    type: string;
    code: string;
    message: string;
    param?: string | null;
    request_id?: string;
}

/** Everything a caller needs to act on a failed request, in one object. */
export class WixzelApiError extends Error {
    readonly status: number;
    readonly type: string;
    readonly code: string;
    readonly param: string | null;
    readonly requestId: string | null;
    readonly retryAfterSeconds: number | null;
    readonly balanceHeader: string | null;

    constructor(
        status: number,
        body: Partial<WixzelErrorBody>,
        headers: { retryAfter?: string | null; balance?: string | null } = {},
    ) {
        super(body.message ?? `HTTP ${status}`);
        this.name = 'WixzelApiError';
        this.status = status;
        this.type = body.type ?? (status >= 500 ? 'api_error' : 'invalid_request_error');
        this.code = body.code ?? `http_${status}`;
        this.param = body.param ?? null;
        this.requestId = body.request_id ?? null;
        this.retryAfterSeconds = headers.retryAfter ? Number(headers.retryAfter) || null : null;
        this.balanceHeader = headers.balance ?? null;
    }
}

export interface WixzelClientOptions {
    apiKey: string;
    baseUrl?: string;
    /** Sent as `Wixzel-Version` to pin dated behaviour. */
    apiVersion?: string;
    /** Per-request timeout in milliseconds. */
    timeoutMs?: number;
    /** Injected in tests. */
    fetch?: typeof fetch;
}

export class WixzelClient {
    readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly apiVersion?: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;

    constructor(opts: WixzelClientOptions) {
        if (!opts.apiKey) {
            throw new Error('WixzelClient needs an apiKey');
        }
        this.apiKey = opts.apiKey;
        this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
        this.apiVersion = opts.apiVersion;
        this.timeoutMs = opts.timeoutMs ?? 30_000;
        this.fetchImpl = opts.fetch ?? globalThis.fetch;
    }

    /** `wv_live_` or `wv_test_` — surfaced so an agent can tell which it is on. */
    get keyMode(): 'live' | 'test' | 'unknown' {
        if (this.apiKey.startsWith('wv_live_')) return 'live';
        if (this.apiKey.startsWith('wv_test_')) return 'test';
        return 'unknown';
    }

    get<T = unknown>(path: string, query?: Record<string, QueryValue>): Promise<T> {
        return this.request<T>('GET', path, { query });
    }

    post<T = unknown>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}): Promise<T> {
        return this.request<T>('POST', path, { ...opts, body });
    }

    patch<T = unknown>(path: string, body: unknown): Promise<T> {
        return this.request<T>('PATCH', path, { body });
    }

    delete<T = unknown>(path: string): Promise<T> {
        return this.request<T>('DELETE', path);
    }

    async request<T = unknown>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
        const url = new URL(this.baseUrl + path);
        for (const [key, value] of Object.entries(opts.query ?? {})) {
            if (value === undefined || value === null || value === '') continue;
            url.searchParams.set(key, String(value));
        }

        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
        };
        if (this.apiVersion) headers['Wixzel-Version'] = this.apiVersion;
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
        const idempotencyKey = opts.idempotencyKey ?? (opts.idempotent ? randomUUID() : undefined);
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

        // One retry budget for the whole call. 429s are never charged and carry
        // Retry-After, so honouring it is the correct behaviour rather than
        // surfacing a transient limit to the agent as a failure.
        const maxAttempts = 3;
        for (let attempt = 1; ; attempt++) {
            const response = await this.fetchImpl(url, {
                method,
                headers,
                body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
                signal: AbortSignal.timeout(this.timeoutMs),
            });

            if (response.status === 429 && attempt < maxAttempts) {
                const retryAfter = Number(response.headers.get('retry-after')) || 1;
                await sleep(Math.min(retryAfter, 10) * 1000);
                continue;
            }

            if (response.status === 204) return null as T;

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
                    parsed && typeof parsed === 'object' && 'error' in parsed
                        ? ((parsed as { error: Partial<WixzelErrorBody> }).error ?? {})
                        : { message: text || response.statusText };
                throw new WixzelApiError(response.status, errorBody, {
                    retryAfter: response.headers.get('retry-after'),
                    balance: response.headers.get('x-wixzel-balance'),
                });
            }

            return (parsed ?? text) as T;
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
