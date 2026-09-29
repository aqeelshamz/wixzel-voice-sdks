/**
 * Response metadata, hung off the returned record without changing its shape.
 *
 * Every method returns the plain typed record, so `JSON.stringify(agent)` is
 * exactly what the API sent. The status, the request id and whether the
 * server replayed an idempotent request are attached under a well-known
 * symbol, non-enumerable, and read with `lastResponse()`.
 */

export interface ResponseMeta {
    status: number;
    /** The `request_id` the API stamps on every response, when present. */
    requestId: string | null;
    /** True when the server answered from its idempotency cache (`Idempotent-Replay: true`). */
    idempotentReplay: boolean;
    headers: Headers;
}

const LAST_RESPONSE = Symbol.for('wixzel-voice.lastResponse');

export function attachResponse<T>(value: T, meta: ResponseMeta): T {
    if (value !== null && typeof value === 'object') {
        Object.defineProperty(value, LAST_RESPONSE, { value: meta, enumerable: false, writable: false, configurable: true });
    }
    return value;
}

/** The HTTP details behind a value the SDK returned, or undefined for primitives. */
export function lastResponse(value: unknown): ResponseMeta | undefined {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as { [LAST_RESPONSE]?: ResponseMeta })[LAST_RESPONSE];
}

export function metaFrom(response: Response): ResponseMeta {
    return {
        status: response.status,
        requestId: response.headers.get('x-request-id'),
        idempotentReplay: response.headers.get('idempotent-replay') === 'true',
        headers: response.headers,
    };
}
