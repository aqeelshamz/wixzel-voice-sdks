import type { Http, RequestOptions } from '../core/http.js';
import type { CreateRealtimeSession, RealtimeSession } from '../types.js';

/**
 * Realtime: an agent in a browser or an app, with no phone line.
 *
 * Call `createSession` on your SERVER — it needs your API key — and pass the
 * result to your client. In a browser, `RealtimeSession` from
 * `wixzel-voice/realtime` does the rest: microphone, playback, barge-in.
 */
export class Realtime {
    constructor(private readonly http: Http) {}

    /**
     * Mint a one-minute, single-use client secret for `wss /v1/realtime`.
     * Nothing is charged until the socket connects; from then on the session
     * bills, counts toward concurrency and is logged exactly like a call.
     */
    createSession(body: CreateRealtimeSession, opts?: RequestOptions): Promise<RealtimeSession> {
        return this.http.request<RealtimeSession>('POST', '/v1/realtime/sessions', { ...opts, body });
    }
}
