/**
 * Streamable HTTP mode: the hosted server at mcp.voice.wixzel.com, and the
 * same thing on a laptop with `--http`.
 *
 * Stateless by design. Every request carries its own `Authorization: Bearer`,
 * which is a Wixzel Voice API key — either pasted by a developer into
 * `claude mcp add --header`, or issued by the API's OAuth server after the
 * user consented in the console. Either way this process builds a fresh MCP
 * server bound to that key, answers the request, and forgets it. Nothing here
 * can mix two users up, because nothing here remembers anyone.
 *
 * The OAuth half lives in the API (api/oauth/index.ts there). This side only
 * has to say where it is: RFC 9728 protected-resource metadata, and a 401 that
 * points at it, are what make claude.ai's "add custom connector" flow work.
 */

import { createHash } from 'node:crypto';
import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DEFAULT_BASE_URL, type WixzelClientOptions } from './client.js';
import { scopes } from './schemas.js';
import { createServer, SERVER_VERSION } from './server.js';
import { consoleUrl, DEFAULT_CONSOLE_URL } from './site.js';

export interface HttpOptions {
    /** TCP port. 0 picks a free one (tests). */
    port: number;
    /** Interface to bind. Loopback by default: nginx terminates TLS in front. */
    bind: string;
    /** The resource identifier tokens are issued for, e.g. https://mcp.voice.wixzel.com/mcp */
    publicUrl: string;
    /**
     * Other hostnames this same server answers on. A request that arrives on
     * one is told the resource is publicUrl with that host. Defaults to
     * hostAliases(publicUrl).
     */
    hostAliases?: readonly string[] | undefined;
    /** The Wixzel Voice API, which is also the OAuth authorization server. */
    apiBaseUrl: string;
    /** The console the landing page links to. Defaults to voice.wixzel.com. */
    consoleUrl?: string | undefined;
    apiVersion?: string | undefined;
    /** Used when a request carries no bearer. Refused on a public host; see resolveHttpOptions. */
    fallbackKey?: string | undefined;
    fetch?: typeof fetch | undefined;
    log?: ((line: string) => void) | undefined;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The hosted server's names. It was mcp.phone.wixzel.com from 8 to 29 September
 * 2026, and that name keeps serving so connectors added then keep working. An
 * MCP client refuses protected-resource metadata whose resource is on another
 * origin than the URL it connected to (the TypeScript SDK's
 * checkResourceAllowed), so each name has to be advertised as itself.
 */
const HOSTED_MCP_HOSTS = ['mcp.voice.wixzel.com', 'mcp.phone.wixzel.com'];

/** The other names of the host in publicUrl, if it is the hosted server; none otherwise. */
export function hostAliases(publicUrl: string): string[] {
    const host = new URL(publicUrl).host.toLowerCase();
    return HOSTED_MCP_HOSTS.includes(host) ? HOSTED_MCP_HOSTS.filter((h) => h !== host) : [];
}

/**
 * The resource a request addressed: publicUrl, or the same URL on the alias
 * host it arrived on (nginx passes the client's Host through). Any other Host
 * gets publicUrl, so a forged header can only pick between our own names.
 */
export function resourceFor(publicUrl: string, aliases: readonly string[], hostHeader: string | undefined): string {
    const host = (hostHeader ?? '').trim().toLowerCase();
    if (!host || !aliases.includes(host)) return publicUrl;
    const url = new URL(publicUrl);
    url.host = host;
    return url.href.replace(/\/+$/, '');
}

function isLoopbackUrl(url: string): boolean {
    try {
        return LOOPBACK.has(new URL(url).hostname);
    } catch {
        return false;
    }
}

/**
 * Environment → options, with the one guard that matters: a fallback key on a
 * host anyone can reach would hand that key's account to every anonymous
 * caller. Refuse to start rather than trust the operator noticed.
 */
export function resolveHttpOptions(env: NodeJS.ProcessEnv, cliPort?: number): HttpOptions {
    const port = cliPort ?? (Number(env.MCP_PORT) || 3939);
    const bind = env.MCP_BIND || '127.0.0.1';
    const publicUrl = (env.MCP_PUBLIC_URL || `http://localhost:${port}/mcp`).replace(/\/+$/, '');
    const fallbackKey = env.WIXZEL_API_KEY || undefined;
    if (fallbackKey && !isLoopbackUrl(publicUrl)) {
        throw new Error(
            `WIXZEL_API_KEY is set but MCP_PUBLIC_URL (${publicUrl}) is not a loopback address. ` +
                'A fallback key on a public host would be handed to every anonymous caller. Unset one of them.',
        );
    }
    return {
        port,
        bind,
        publicUrl,
        hostAliases: hostAliases(publicUrl),
        apiBaseUrl: (env.WIXZEL_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
        consoleUrl: consoleUrl(env),
        apiVersion: env.WIXZEL_API_VERSION || undefined,
        fallbackKey,
    };
}

// ─── Token probe ────────────────────────────────────────────────────────────
//
// The API is the authority on whether a key is live; this process never sees
// the key table. But a revoked key must produce a 401 HERE, not an isError
// tool result: the 401 is what tells claude.ai to run OAuth again, and a tool
// error is what tells it the tool failed. One cheap request against a route
// that needs no scope, cached briefly by key hash, gives the right answer.

type Verdict = 'ok' | 'rejected' | 'unknown';
const PROBE_OK_MS = 60_000;
const PROBE_REJECTED_MS = 10_000;

export class TokenProbe {
    private readonly cache = new Map<string, { verdict: Verdict; until: number }>();

    constructor(
        private readonly apiBaseUrl: string,
        private readonly fetchImpl: typeof fetch,
    ) { }

    async check(apiKey: string): Promise<Verdict> {
        const id = createHash('sha256').update(apiKey).digest('hex');
        const hit = this.cache.get(id);
        if (hit && hit.until > Date.now()) return hit.verdict;

        let verdict: Verdict;
        try {
            const res = await this.fetchImpl(`${this.apiBaseUrl}/v1/engines`, {
                headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(5_000),
            });
            verdict = res.status === 401 ? 'rejected' : res.status < 500 ? 'ok' : 'unknown';
        } catch {
            verdict = 'unknown';
        }
        if (verdict !== 'unknown') {
            this.cache.set(id, { verdict, until: Date.now() + (verdict === 'ok' ? PROBE_OK_MS : PROBE_REJECTED_MS) });
        }
        if (this.cache.size > 10_000) this.cache.clear();
        return verdict;
    }
}

// ─── The handler ────────────────────────────────────────────────────────────

function bearerFrom(req: IncomingMessage): string | undefined {
    const header = req.headers.authorization;
    if (!header) return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match?.[1]?.trim() || undefined;
}

/** No cookies exist on this host, so a wildcard is safe and browser-based MCP clients need it. */
function cors(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version');
    res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
}

export function protectedResourceMetadata(opts: HttpOptions, resource: string = opts.publicUrl) {
    return {
        resource,
        authorization_servers: [opts.apiBaseUrl],
        bearer_methods_supported: ['header'],
        scopes_supported: [...scopes],
        resource_name: 'Wixzel Voice',
        resource_documentation: 'https://docs.voice.wixzel.com/mcp-server',
    };
}

/** RFC 9728 §3: the well-known path carries the resource's own path as a suffix. */
export function resourceMetadataUrl(publicUrl: string): string {
    const url = new URL(publicUrl);
    const suffix = url.pathname === '/' ? '' : url.pathname;
    return `${url.origin}/.well-known/oauth-protected-resource${suffix}`;
}

export function createHttpHandler(opts: HttpOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    const fetchImpl = opts.fetch ?? globalThis.fetch;
    const probe = new TokenProbe(opts.apiBaseUrl, fetchImpl);
    const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const metadataPaths = new Set(['/.well-known/oauth-protected-resource', new URL(resourceMetadataUrl(opts.publicUrl)).pathname]);
    const mcpPath = new URL(opts.publicUrl).pathname === '/' ? '/mcp' : new URL(opts.publicUrl).pathname;
    const aliases = (opts.hostAliases ?? hostAliases(opts.publicUrl)).map((h) => h.toLowerCase());

    const challenge = (resource: string, error?: string) =>
        `Bearer realm="wixzel-voice-mcp", resource_metadata="${resourceMetadataUrl(resource)}"` +
        (error ? `, error="${error}"` : '');

    return async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const resource = resourceFor(opts.publicUrl, aliases, req.headers.host);
        cors(res);

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (url.pathname === '/healthz') {
            return json(res, 200, { ok: true, name: 'wixzel-voice-mcp', version: SERVER_VERSION });
        }
        // People do open the bare host in a browser, and connector UIs that
        // want an icon parse this page for one. A sentence and a few links.
        if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' });
            res.end(LANDING_HTML(mcpPath, opts.publicUrl, (opts.consoleUrl ?? consoleUrl()).replace(/\/+$/, '')));
            return;
        }
        if (metadataPaths.has(url.pathname)) {
            // Varies by Host now that one process answers for two names.
            return json(res, 200, protectedResourceMetadata(opts, resource), { 'cache-control': 'public, max-age=300', vary: 'Host' });
        }
        if (url.pathname !== mcpPath) {
            return json(res, 404, { error: 'not_found', message: `MCP is served at ${mcpPath}` });
        }

        const presented = bearerFrom(req);
        const apiKey = presented ?? opts.fallbackKey;
        if (!apiKey) {
            return json(res, 401, {
                error: 'unauthorized',
                message: 'Send a Wixzel Voice API key as "Authorization: Bearer wv_live_…", or connect through OAuth.',
            }, { 'www-authenticate': challenge(resource) });
        }
        if (presented && (await probe.check(presented)) === 'rejected') {
            return json(res, 401, {
                error: 'invalid_token',
                message: 'That API key is invalid, revoked or expired. Reconnect to obtain a new one.',
            }, { 'www-authenticate': challenge(resource, 'invalid_token') });
        }

        const clientOptions: WixzelClientOptions = {
            apiKey,
            baseUrl: opts.apiBaseUrl,
            apiVersion: opts.apiVersion,
            fetch: fetchImpl,
        };
        const server = createServer({ client: clientOptions });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        // The transport decides most 4xx answers itself and says why only
        // through this hook; without it a client's "couldn't load tools" is
        // a status code and nothing else in the logs.
        transport.onerror = (error) => log(`wixzel-voice-mcp: transport: ${error.message}`);
        server.server.onerror = (error) => log(`wixzel-voice-mcp: server: ${error.message}`);
        res.on('finish', () => {
            if (res.statusCode >= 400) {
                const h = req.headers;
                log(
                    `wixzel-voice-mcp: ${res.statusCode} ${req.method} ${url.pathname}` +
                        ` accept=${JSON.stringify(h.accept ?? null)} content-type=${JSON.stringify(h['content-type'] ?? null)}` +
                        ` length=${h['content-length'] ?? '?'} protocol=${h['mcp-protocol-version'] ?? '-'} session=${h['mcp-session-id'] ? 'yes' : 'no'}` +
                        ` ua=${JSON.stringify(h['user-agent'] ?? null)}`,
                );
            }
        });
        res.on('close', () => {
            void transport.close();
            void server.close();
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res);
        } catch (error) {
            log(`wixzel-voice-mcp: request failed: ${(error as Error).message}`);
            if (!res.headersSent) json(res, 500, { error: 'internal_error' });
        }
    };
}

const LANDING_HTML = (mcpPath: string, publicUrl: string, consoleBase: string) => {
    // Our product pages only on our own server. A self-hosted install links
    // its own console and the public docs, and nothing that sells.
    const product = consoleBase === DEFAULT_CONSOLE_URL
        ? ` · <a href="${DEFAULT_CONSOLE_URL}/solutions/ai-agents-mcp">What you can build</a> · <a href="${DEFAULT_CONSOLE_URL}">Wixzel Voice</a>`
        : '';
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Wixzel Voice MCP server</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Connect Claude, ChatGPT, Cursor or any other MCP client to Wixzel Voice and build AI agents that place and answer real phone calls.">
<link rel="icon" href="/favicon.ico"><link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0d0d;color:#e8e8e8;font:15px/1.5 system-ui,sans-serif}main{max-width:32rem;padding:2rem}code{background:#1a1a1a;padding:.15em .4em;border-radius:.3em}a{color:#a0d425}</style>
</head><body><main>
<img src="/icon-192.png" alt="" width="48" height="48">
<h1>Wixzel Voice MCP server</h1>
<p>Connect Claude, ChatGPT, Cursor or any other MCP client to Wixzel Voice and build AI agents that place and answer real phone calls.</p>
<p>This host speaks the Model Context Protocol at <code>${mcpPath}</code>. Add it as a connector in claude.ai or Claude Desktop, or run <code>claude mcp add --transport http wixzel-voice ${publicUrl}</code>.</p>
<p><a href="https://docs.voice.wixzel.com/mcp-server">Documentation</a> · <a href="${consoleBase}/connect">Connect your account</a>${product}</p>
</main></body></html>
`;
};

export interface RunningHttpServer {
    server: Server;
    /** The bound address, useful when port 0 was requested. */
    port: number;
    close(): Promise<void>;
}

export async function startHttp(opts: HttpOptions): Promise<RunningHttpServer> {
    const handler = createHttpHandler(opts);
    const server = createNodeServer((req, res) => {
        void handler(req, res);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port, opts.bind, () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : opts.port;
    return {
        server,
        port,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}
