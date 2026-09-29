/**
 * The glue between a tool definition and the MCP server: result formatting,
 * error translation, and the annotation presets that tell a client which
 * tools are safe to call without asking.
 */

import { consoleUrl } from './site.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod/v4';
import { WixzelApiError, type WixzelClient } from './client.js';

export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
    name: string;
    title: string;
    description: string;
    input: Shape;
    /**
     * The API operation this tool wraps, as `METHOD /v1/path/{id}`. Never used
     * at runtime; the spec-coverage test compares it to the OpenAPI document so
     * an endpoint added to the API cannot go unwrapped, and a tool cannot claim
     * an endpoint that does not exist.
     */
    endpoint: string;
    annotations: ToolAnnotations;
    /** The API scope the key must hold. Surfaced in errors when the key lacks it. */
    scope?: string;
    handler: (client: WixzelClient, args: ShapeArgs<Shape>) => Promise<unknown>;
}

// The SDK infers the parsed argument type from the raw shape; this mirrors
// that inference so handlers are typed without importing SDK internals.
type ShapeArgs<Shape extends ZodRawShape> = {
    [K in keyof Shape]: Shape[K] extends { _output: infer O } ? O : unknown;
};

/** Presets. Every tool picks exactly one. */
export const annotate = {
    /** Reads a record or a list. Safe to call freely. */
    read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as ToolAnnotations,
    /** Creates or updates a record on the account. Reversible. */
    write: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as ToolAnnotations,
    /** Same as write, and calling it twice is the same as once. */
    writeIdempotent: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as ToolAnnotations,
    /** Deletes or revokes. Not reversible. */
    destructive: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as ToolAnnotations,
    /** Spends credit or makes a phone ring in the real world. */
    spend: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as ToolAnnotations,
    /** Sends traffic to a third party (a carrier) without spending. */
    probe: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as ToolAnnotations,
};

export function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
    return def;
}

export function registerTools(server: McpServer, client: WixzelClient, tools: ToolDef<any>[]): void {
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.scope ? `${tool.description}\n\nRequires scope \`${tool.scope}\`.` : tool.description,
                inputSchema: tool.input,
                annotations: tool.annotations,
            },
            async (args: Record<string, unknown>) => {
                try {
                    const result = await tool.handler(client, args as never);
                    return ok(result);
                } catch (error) {
                    return fail(error, tool);
                }
            },
        );
    }
}

export function ok(data: unknown): CallToolResult {
    const text =
        data === null || data === undefined
            ? 'Done.'
            : typeof data === 'string'
              ? data
              : JSON.stringify(data, null, 2);
    return { content: [{ type: 'text', text }] };
}

export function fail(error: unknown, tool?: ToolDef<any>): CallToolResult {
    return { isError: true, content: [{ type: 'text', text: describeError(error, tool) }] };
}

/**
 * Turn a failure into something an agent can act on: the machine-readable code
 * first (the docs say to match on it, not the message), then the human
 * message, then what to do about it.
 */
export function describeError(error: unknown, tool?: ToolDef<any>): string {
    if (error instanceof WixzelApiError) {
        const lines = [
            `Wixzel Voice API error ${error.status} (${error.type} / ${error.code}): ${error.message}`,
        ];
        if (error.param) lines.push(`Parameter: ${error.param}`);
        if (error.requestId) lines.push(`request_id: ${error.requestId}`);
        const hint = hintFor(error, tool);
        if (hint) lines.push(`Hint: ${hint}`);
        return lines.join('\n');
    }
    if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return `The request to the Wixzel Voice API timed out. ${tool?.annotations.idempotentHint ? 'It is safe to retry.' : 'If this tool spends money, retry with the same idempotency_key so it is not repeated.'}`;
        }
        return `Request failed: ${error.message}`;
    }
    return `Request failed: ${String(error)}`;
}

function hintFor(error: WixzelApiError, tool?: ToolDef<any>): string | null {
    switch (error.code) {
        case 'insufficient_credits':
            return `The account balance cannot cover this. ${error.balanceHeader ? `Current balance: ${error.balanceHeader}. ` : ''}Add credit with create_topup (returns a checkout URL for a human to pay) or in the dashboard at ${consoleUrl()}.`;
        case 'insufficient_scope':
        case 'permission_denied':
            return `The API key does not hold ${tool?.scope ? `the \`${tool.scope}\` scope` : 'the scope this endpoint needs'}. Keys are scoped with no wildcard; create one with that scope in Dashboard → API keys, then restart this MCP server with it.`;
        case 'scope_escalation':
            return 'A key cannot grant scopes it does not itself hold. Drop the extra scopes, or create the key from the dashboard.';
        case 'unsupported_model':
            return 'Call list_engines and pick a model from what it returns. The message above lists what is available for that component.';
        case 'idempotency_key_reuse':
            return 'That idempotency_key was already used with a different body. Use a fresh key for a new request.';
        case 'idempotency_key_in_flight':
            return 'The original request is still running. Wait a moment and retry with the same idempotency_key; do not start a second one.';
        case 'rate_limit_exceeded':
            return `Rate limited (10 req/s, burst 20). Nothing was charged. Wait ${error.retryAfterSeconds ?? 1}s and retry.`;
        case 'invalid_cursor':
        case 'conflicting_cursors':
            return 'Pass exactly one cursor, copied verbatim from a previous response\'s next_cursor.';
        default:
            break;
    }
    switch (error.type) {
        case 'authentication_error':
            return 'The API key is missing, malformed, revoked or expired. Set WIXZEL_API_KEY to a valid wv_live_ or wv_test_ key.';
        case 'permission_error':
            return `The API key does not hold ${tool?.scope ? `the \`${tool.scope}\` scope` : 'the scope this endpoint needs'}. Create a key with it in Dashboard → API keys.`;
        case 'not_found_error':
            return 'No such record on this account. A record owned by another account also returns 404. List the resource to find the right id.';
        case 'conflict_error':
            return 'The request conflicts with the record\'s current state. Fetch it and look at its status before retrying.';
        case 'api_error':
            return 'Something failed on the Wixzel side. Quote the request_id if reporting it. Retry once after a short wait.';
        default:
            return null;
    }
}

/** Drop keys whose value is undefined so PATCH bodies only carry what was sent. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
    const out: Partial<T> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) (out as Record<string, unknown>)[key] = value;
    }
    return out;
}
