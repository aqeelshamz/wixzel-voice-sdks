import { Http, type HttpMethod, type HttpOptions, type Query, type RequestOptions } from './core/http.js';
import { Agents } from './resources/agents.js';
import { ApiKeys } from './resources/api-keys.js';
import { Appointments } from './resources/appointments.js';
import { Billing } from './resources/billing.js';
import { Calls } from './resources/calls.js';
import { Campaigns } from './resources/campaigns.js';
import { Engines } from './resources/engines.js';
import { Webhooks } from './resources/webhooks.js';
import { Realtime } from './resources/realtime.js';
import { KnowledgeBases } from './resources/knowledge-bases.js';
import { Leads } from './resources/leads.js';
import { PhoneNumbers } from './resources/phone-numbers.js';
import { SipTrunks } from './resources/sip-trunks.js';
import { Usage } from './resources/usage.js';

export interface WixzelVoiceOptions {
    /** Your API key, `wv_live_…` or `wv_test_…`. */
    apiKey: string;
    /** Defaults to https://api.voice.wixzel.com. */
    baseUrl?: string;
    /** A `Wixzel-Version` date, e.g. `2026-09-01`, so an upgrade is something you do rather than something that happens to you. */
    apiVersion?: string;
    /** Per-attempt timeout. Default 30 s. */
    timeoutMs?: number;
    /** Retries after the first attempt, for 429s and transient failures on repeatable requests. Default 2. */
    maxRetries?: number;
    /** A fetch to use instead of the global one. */
    fetch?: typeof fetch;
    /** Headers sent on every request. */
    defaultHeaders?: Record<string, string>;
    /** Replace the wait between retries; for tests. */
    sleep?: (ms: number) => Promise<void>;
}

/**
 * The Wixzel Voice API.
 *
 *   const client = new WixzelVoice({ apiKey: process.env.WIXZEL_API_KEY! });
 *   const call = await client.calls.create({ to: '+14155551234', agent_id: 'ag_…' });
 */
export class WixzelVoice {
    readonly agents: Agents;
    readonly calls: Calls;
    readonly leads: Leads;
    readonly campaigns: Campaigns;
    readonly knowledgeBases: KnowledgeBases;
    readonly phoneNumbers: PhoneNumbers;
    readonly sipTrunks: SipTrunks;
    readonly appointments: Appointments;
    readonly usage: Usage;
    readonly billing: Billing;
    readonly apiKeys: ApiKeys;
    readonly engines: Engines;
    readonly webhooks: Webhooks;
    /** Server-side half of realtime; the browser half is `wixzel-voice/realtime`. */
    readonly realtime: Realtime;

    private readonly http: Http;

    constructor(options: WixzelVoiceOptions) {
        const httpOptions: HttpOptions = { apiKey: options.apiKey };
        if (options.baseUrl !== undefined) httpOptions.baseUrl = options.baseUrl;
        if (options.apiVersion !== undefined) httpOptions.apiVersion = options.apiVersion;
        if (options.timeoutMs !== undefined) httpOptions.timeoutMs = options.timeoutMs;
        if (options.maxRetries !== undefined) httpOptions.maxRetries = options.maxRetries;
        if (options.fetch !== undefined) httpOptions.fetch = options.fetch;
        if (options.defaultHeaders !== undefined) httpOptions.defaultHeaders = options.defaultHeaders;
        if (options.sleep !== undefined) httpOptions.sleep = options.sleep;
        this.http = new Http(httpOptions);

        this.agents = new Agents(this.http);
        this.calls = new Calls(this.http);
        this.leads = new Leads(this.http);
        this.campaigns = new Campaigns(this.http);
        this.knowledgeBases = new KnowledgeBases(this.http);
        this.phoneNumbers = new PhoneNumbers(this.http);
        this.sipTrunks = new SipTrunks(this.http);
        this.appointments = new Appointments(this.http);
        this.usage = new Usage(this.http);
        this.billing = new Billing(this.http);
        this.apiKeys = new ApiKeys(this.http);
        this.engines = new Engines(this.http);
        this.webhooks = new Webhooks(this.http);
        this.realtime = new Realtime(this.http);
    }

    /** `live`, `test`, or `unknown` for a key that is neither. */
    get keyMode(): 'live' | 'test' | 'unknown' {
        return this.http.keyMode;
    }

    /** The base URL requests go to. */
    get baseUrl(): string {
        return this.http.baseUrl;
    }

    /**
     * Call an endpoint the SDK does not model yet, with the same auth, retry
     * and error handling. `path` starts with `/v1/`.
     */
    request<T = unknown>(
        method: HttpMethod,
        path: string,
        init: { query?: Query; body?: unknown; idempotent?: boolean } & RequestOptions = {},
    ): Promise<T> {
        return this.http.request<T>(method, path, init);
    }
}

// The names this client had as `wixzel-phone` (0.3.0 and earlier), so code
// moving across only has to change its import.

/** @deprecated Use WixzelVoice. */
export const WixzelPhone = WixzelVoice;
/** @deprecated Use WixzelVoice. */
export type WixzelPhone = WixzelVoice;
/** @deprecated Use WixzelVoiceOptions. */
export type WixzelPhoneOptions = WixzelVoiceOptions;
