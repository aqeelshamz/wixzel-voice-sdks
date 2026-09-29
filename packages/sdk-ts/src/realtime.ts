/**
 * `wixzel-voice/realtime` — talk to a Wixzel Voice agent from a browser.
 *
 *     // your server
 *     const session = await wixzel.realtime.createSession({ agent_id });
 *     // your page
 *     import { RealtimeSession } from 'wixzel-voice/realtime';
 *     const call = await RealtimeSession.connect(session, {
 *         onTranscript: (t) => console.log(t.role, t.text),
 *         onEnd: (reason) => console.log('ended', reason),
 *     });
 *     // later: call.end()
 *
 * Microphone → an AudioWorklet that encodes G.711 µ-law 8 kHz → the socket →
 * the engine → the socket → scheduled playback, with barge-in. The audio is
 * telephony band on purpose: it is exactly what a caller on a phone line
 * hears, and the same engine code runs either way.
 *
 * Browser-only (it needs AudioContext and getUserMedia) and dependency-free.
 * It never sees your API key: it takes the `client_secret` your server minted.
 * For Flutter, the Dart SDK has the protocol client; for anything else the
 * protocol is in the Realtime guide.
 *
 * apps/web/lib/realtime-session.ts is a byte-for-byte copy that drives the
 * landing-page demo (Vercel builds the site alone, without the workspace);
 * test/realtime-copy.test.ts keeps the two identical.
 */

const FRAME_BYTES = 160; // 20 ms at 8 kHz
const TARGET_RATE = 8000;
/** How far ahead of the clock playback is scheduled; absorbs network jitter. */
const JITTER_LEAD_S = 0.15;
/** Longest the mic stays held waiting for the agent's opening line. */
const GREETING_HOLD_MAX_MS = 8000;
/** 20 ms of µ-law silence (0xFF), sent while the mic is held. */
const SILENCE_FRAME = new Uint8Array(FRAME_BYTES).fill(0xff);
/** When the agent hangs up, let its goodbye finish — but never wait longer than this. */
const GOODBYE_MAX_WAIT_MS = 4000;

/**
 * The capture worklet, inlined and loaded from a Blob URL so an app does not
 * have to serve a separate file. Encodes 20 ms frames of µ-law at 8 kHz; when
 * the browser will not run the context at 8 kHz it low-passes and decimates.
 */
const WORKLET_SOURCE = `
const FRAME=160,BIAS=0x84,CLIP=32635;
function enc(s){let g=(s>>8)&0x80;if(g!==0)s=-s;if(s>CLIP)s=CLIP;s+=BIAS;let e=7;for(let m=0x4000;(s&m)===0&&e>0;e--,m>>=1);const t=(s>>(e+3))&0x0f;return(~(g|(e<<4)|t))&0xff;}
class P extends AudioWorkletProcessor{constructor(o){super();const p=(o&&o.processorOptions)||{};this.d=Math.max(1,Math.round(p.decimation||1));this.f=new Int16Array(FRAME);this.n=0;this.ph=0;this.lp=0;this.a=this.d>1?1/this.d:1;this.mu=false;this.port.onmessage=(e)=>{if(e.data&&e.data.type==='mute')this.mu=!!e.data.value;};}
process(i){const c=i[0]&&i[0][0];if(!c)return true;for(let k=0;k<c.length;k++){let s=c[k];if(this.d>1){this.lp+=this.a*(s-this.lp);if(this.ph++%this.d!==0)continue;s=this.lp;}const v=this.mu?0:Math.max(-1,Math.min(1,s));this.f[this.n++]=v<0?v*0x8000:v*0x7fff;if(this.n===FRAME){const out=new Uint8Array(FRAME);let pk=0;for(let j=0;j<FRAME;j++){const x=this.f[j];if(x>pk)pk=x;out[j]=enc(x);}this.port.postMessage({frame:out,peak:pk/0x7fff},[out.buffer]);this.n=0;}}return true;}}
registerProcessor('wixzel-mulaw-capture',P);`;

const MULAW_DECODE = (() => {
    const table = new Int16Array(256);
    for (let i = 0; i < 256; i++) {
        const inv = ~i & 0xff;
        const sign = inv & 0x80;
        const exponent = (inv >> 4) & 0x07;
        const mantissa = inv & 0x0f;
        let sample = ((mantissa << 3) + 0x84) << exponent;
        sample -= 0x84;
        table[i] = sign ? -sample : sample;
    }
    return table;
})();

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
}

export type RealtimeStatus = 'idle' | 'requesting-mic' | 'connecting' | 'live' | 'ended';

/** Why a session ended. The server's reasons, plus `refused` for a session that never started. */
export type RealtimeEndReason =
    | 'client' | 'agent' | 'max_duration' | 'idle' | 'insufficient_credits' | 'error' | 'disconnected' | 'refused';

export type RealtimeFailure = 'mic-denied' | 'mic-unavailable' | 'insecure-context' | 'unsupported-browser' | 'connection-failed';

export interface RealtimeTranscript {
    role: 'user' | 'assistant';
    text: string;
}

export interface RealtimeError {
    code: string;
    message: string;
}

/** A frame from the server, for anyone who wants all of them. */
export type RealtimeServerEvent =
    | { type: 'session.started'; session_id: string; call_id: string; agent_id: string; engine: string; max_duration_seconds: number; audio_format: 'mulaw_8000' }
    | { type: 'audio'; audio: string }
    | { type: 'audio.clear' }
    | { type: 'transcript'; role: 'user' | 'assistant'; text: string }
    | { type: 'session.warning'; code: string; seconds_remaining?: number }
    | { type: 'error'; code: string; message: string }
    | { type: 'session.ended'; reason: RealtimeEndReason; duration_seconds: number };

export interface RealtimeHandlers {
    onStatus?: (status: RealtimeStatus) => void;
    onStarted?: (info: Extract<RealtimeServerEvent, { type: 'session.started' }>) => void;
    onTranscript?: (t: RealtimeTranscript) => void;
    /** Microphone level, 0–1, about 50 times a second. */
    onLevel?: (peak: number) => void;
    /** Agent audio is audible right now. */
    onAgentSpeaking?: (speaking: boolean) => void;
    onWarning?: (w: { code: string; seconds_remaining?: number }) => void;
    onError?: (e: RealtimeError) => void;
    onFailure?: (kind: RealtimeFailure) => void;
    onEnd?: (reason: RealtimeEndReason) => void;
    /** Every server frame, raw. */
    onEvent?: (e: RealtimeServerEvent) => void;
}

/** What `createSession` returned — or just the two fields this needs. */
export interface RealtimeSessionInfo {
    url: string;
    client_secret: { value: string };
}

/**
 * Ask for the microphone. Split out so a page can do it BEFORE asking its
 * server for a session: a visitor who denies the prompt then never costs you
 * a minted secret.
 */
export async function requestMicrophone(): Promise<MediaStream | RealtimeFailure> {
    if (typeof window === 'undefined') return 'unsupported-browser';
    if (!window.isSecureContext) return 'insecure-context';
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') return 'unsupported-browser';
    try {
        return await navigator.mediaDevices.getUserMedia({
            // Echo cancellation is load-bearing: without it the agent's own voice
            // returns through the mic and it interrupts itself.
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
            video: false,
        });
    } catch (err) {
        const name = (err as DOMException)?.name;
        return name === 'NotAllowedError' || name === 'SecurityError' ? 'mic-denied' : 'mic-unavailable';
    }
}

export class RealtimeSession {
    private ws: WebSocket | null = null;
    private ctx: AudioContext | null = null;
    private stream: MediaStream | null = null;
    private node: AudioWorkletNode | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private playing = new Set<AudioBufferSourceNode>();
    private cursor = 0;
    private speaking = false;
    private speakingTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * The agent opens the conversation. Until its first audio arrives the mic
     * sends silence, so room noise cannot barge in over a greeting nobody has
     * heard yet. Once the agent is audible, interrupting works normally.
     */
    private holdingForGreeting = true;
    private greetingHoldTimer: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;
    private status: RealtimeStatus = 'idle';
    private refusal: RealtimeError | null = null;

    constructor(private readonly handlers: RealtimeHandlers = {}) { }

    /** Ask for the mic, connect, and resolve once the socket is open (or the attempt failed). */
    static async connect(session: RealtimeSessionInfo, handlers: RealtimeHandlers = {}): Promise<RealtimeSession> {
        const s = new RealtimeSession(handlers);
        s.setStatus('requesting-mic');
        const mic = await requestMicrophone();
        if (typeof mic === 'string') {
            handlers.onFailure?.(mic);
            s.setStatus('idle');
            return s;
        }
        await s.start(mic, session);
        return s;
    }

    get currentStatus(): RealtimeStatus { return this.status; }

    private setStatus(status: RealtimeStatus) {
        if (this.status === status) return;
        this.status = status;
        this.handlers.onStatus?.(status);
    }

    /** Use a microphone you already hold (see `requestMicrophone`). */
    async start(stream: MediaStream, session: RealtimeSessionInfo): Promise<void> {
        this.stream = stream;
        if (this.stopped) return void this.end();

        try {
            await this.openAudio();
        } catch {
            this.handlers.onFailure?.('unsupported-browser');
            await this.finish('error');
            return;
        }
        if (this.stopped) return void this.end();

        this.setStatus('connecting');
        const url = `${session.url}${session.url.includes('?') ? '&' : '?'}client_secret=${encodeURIComponent(session.client_secret.value)}`;
        await new Promise<void>((resolve) => this.openSocket(url, resolve));
    }

    private async openAudio() {
        // Ask for 8 kHz so the browser's own resampler does the anti-alias
        // work; the rate the context actually runs at decides whether the
        // worklet decimates.
        let ctx: AudioContext;
        try {
            ctx = new AudioContext({ sampleRate: TARGET_RATE });
        } catch {
            ctx = new AudioContext();
        }
        this.ctx = ctx;
        if (ctx.state === 'suspended') await ctx.resume();

        const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        try {
            await ctx.audioWorklet.addModule(blobUrl);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }

        const decimation = Math.max(1, Math.round(ctx.sampleRate / TARGET_RATE));
        this.node = new AudioWorkletNode(ctx, 'wixzel-mulaw-capture', {
            numberOfInputs: 1,
            numberOfOutputs: 0,
            processorOptions: { decimation },
        });
        this.node.port.onmessage = (e) => {
            const { frame, peak } = e.data as { frame: Uint8Array; peak: number };
            if (typeof peak === 'number') this.handlers.onLevel?.(peak);
            this.sendFrame(frame);
        };

        this.source = ctx.createMediaStreamSource(this.stream!);
        this.source.connect(this.node);
    }

    private openSocket(url: string, opened: () => void) {
        const ws = new WebSocket(url);
        this.ws = ws;
        let settled = false;
        const settle = () => { if (!settled) { settled = true; opened(); } };

        ws.onopen = () => {
            this.setStatus('live');
            // Safety valve: if the agent never speaks, the user must still be
            // able to talk rather than sit muted until the session times out.
            this.greetingHoldTimer = setTimeout(() => this.releaseGreetingHold(), GREETING_HOLD_MAX_MS);
            settle();
        };

        ws.onmessage = (event) => {
            let msg: RealtimeServerEvent;
            try { msg = JSON.parse(event.data as string); } catch { return; }
            this.handlers.onEvent?.(msg);

            switch (msg.type) {
                case 'session.started':
                    this.handlers.onStarted?.(msg);
                    break;
                case 'audio':
                    this.playChunk(base64ToBytes(msg.audio));
                    break;
                case 'audio.clear':
                    this.flushPlayback();
                    break;
                case 'transcript':
                    this.handlers.onTranscript?.({ role: msg.role, text: msg.text });
                    break;
                case 'session.warning':
                    this.handlers.onWarning?.(msg);
                    break;
                case 'error':
                    this.refusal = { code: msg.code, message: msg.message };
                    this.handlers.onError?.(this.refusal);
                    break;
                case 'session.ended':
                    // An agent hanging up has a goodbye still queued here; let it play.
                    if (msg.reason === 'agent') void this.finishAfterPlayout('agent');
                    else void this.finish(msg.reason);
                    break;
            }
        };

        ws.onerror = () => {
            if (this.status === 'connecting') this.handlers.onFailure?.('connection-failed');
        };

        ws.onclose = (ev) => {
            settle();
            if (this.stopped) return;
            // Closed with an application code and an `error` frame: refused
            // before it started (bad secret, no credit, at the limit).
            if (ev.code >= 4000 && this.refusal) { void this.finish('refused'); return; }
            if (this.status === 'connecting') {
                this.handlers.onFailure?.('connection-failed');
                void this.finish('error');
                return;
            }
            void this.finish('disconnected');
        };
    }

    private sendFrame(frame: Uint8Array) {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        // Under backpressure, drop rather than queue: stale mic audio is worse than none.
        if (ws.bufferedAmount > 256 * 1024) return;
        if (frame.length !== FRAME_BYTES) return;
        // Silence rather than nothing: speech recognition times out if audio
        // stops arriving, so the stream keeps flowing while held.
        const payload = this.holdingForGreeting ? SILENCE_FRAME : frame;
        ws.send(JSON.stringify({ type: 'audio', audio: bytesToBase64(payload) }));
    }

    private playChunk(bytes: Uint8Array) {
        const ctx = this.ctx;
        if (!ctx || this.stopped) return;

        const samples = new Float32Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) samples[i] = MULAW_DECODE[bytes[i]!]! / 32768;
        // Built at 8 kHz; the browser resamples natively when the context runs faster.
        const buffer = ctx.createBuffer(1, samples.length, TARGET_RATE);
        buffer.copyToChannel(samples, 0);

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);

        // Re-prime the cursor after any gap, or playback would start in the past.
        if (this.cursor < ctx.currentTime + 0.02) this.cursor = ctx.currentTime + JITTER_LEAD_S;
        src.start(this.cursor);
        this.cursor += buffer.duration;

        this.playing.add(src);
        src.onended = () => this.playing.delete(src);

        this.releaseGreetingHold();
        this.markSpeaking();
    }

    private releaseGreetingHold() {
        if (!this.holdingForGreeting) return;
        this.holdingForGreeting = false;
        if (this.greetingHoldTimer) { clearTimeout(this.greetingHoldTimer); this.greetingHoldTimer = null; }
    }

    private markSpeaking() {
        if (!this.speaking) {
            this.speaking = true;
            this.handlers.onAgentSpeaking?.(true);
        }
        if (this.speakingTimer) clearTimeout(this.speakingTimer);
        const remainingMs = Math.max(0, (this.cursor - (this.ctx?.currentTime ?? 0)) * 1000);
        this.speakingTimer = setTimeout(() => {
            this.speaking = false;
            this.handlers.onAgentSpeaking?.(false);
        }, remainingMs + 120);
    }

    /** Barge-in: drop everything queued so the agent stops mid-word. */
    private flushPlayback() {
        for (const src of this.playing) {
            try { src.stop(); } catch { /* already finished */ }
        }
        this.playing.clear();
        this.cursor = 0;
        if (this.speakingTimer) { clearTimeout(this.speakingTimer); this.speakingTimer = null; }
        if (this.speaking) {
            this.speaking = false;
            this.handlers.onAgentSpeaking?.(false);
        }
    }

    private async finishAfterPlayout(reason: RealtimeEndReason) {
        const ctx = this.ctx;
        const remainingMs = ctx ? Math.max(0, (this.cursor - ctx.currentTime) * 1000) : 0;
        this.stopMic();
        await new Promise((r) => setTimeout(r, Math.min(remainingMs + 150, GOODBYE_MAX_WAIT_MS)));
        await this.finish(reason);
    }

    /** Mute the microphone. Silence keeps flowing, so the session stays up. */
    setMuted(muted: boolean): void {
        this.node?.port.postMessage({ type: 'mute', value: muted });
    }

    /** Hang up. Idempotent; resolves once the mic is released. */
    end(): Promise<void> {
        return this.finish('client');
    }

    private stopMic() {
        try { this.source?.disconnect(); } catch { /* already disconnected */ }
        try { this.node?.disconnect(); } catch { /* already disconnected */ }
        if (this.node) this.node.port.onmessage = null;
        this.source = null;
        this.node = null;
        // Stopping the tracks is what turns the browser's mic indicator off.
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
    }

    private async finish(reason: RealtimeEndReason): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;

        this.flushPlayback();
        if (this.greetingHoldTimer) { clearTimeout(this.greetingHoldTimer); this.greetingHoldTimer = null; }

        const ws = this.ws;
        this.ws = null;
        if (ws) {
            try {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'session.end' }));
                ws.onclose = null;
                ws.close();
            } catch { /* already gone */ }
        }

        this.stopMic();

        const ctx = this.ctx;
        this.ctx = null;
        if (ctx && ctx.state !== 'closed') { try { await ctx.close(); } catch { /* already closed */ } }

        this.setStatus('ended');
        this.handlers.onEnd?.(reason);
    }
}
