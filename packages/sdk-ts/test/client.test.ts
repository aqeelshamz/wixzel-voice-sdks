import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_BASE_URL,
    WixzelVoice,
    WixzelPhone,
    type WixzelPhoneOptions,
    WixzelError,
    WixzelConnectionError,
    lastResponse,
} from '../src/index.js';
import { apiError, fakeFetch } from './helpers/fake-fetch.js';

const api = fakeFetch();
const make = (opts: Partial<ConstructorParameters<typeof WixzelVoice>[0]> = {}) =>
    new WixzelVoice({ apiKey: 'wv_test_abc', baseUrl: 'https://api.example/', fetch: api.fetchImpl, sleep: api.sleep, ...opts });

beforeEach(() => api.reset());

describe('client basics', () => {
    test('sends the bearer, accept, user agent and client headers, and no content type on GET', async () => {
        const client = make();
        api.queue.push({ status: 200, body: { id: 'ag1' } });
        await client.agents.retrieve('ag1');
        const req = api.last();
        assert.equal(req.method, 'GET');
        assert.equal(req.url.href, 'https://api.example/v1/agents/ag1');
        assert.equal(req.headers.authorization, 'Bearer wv_test_abc');
        assert.equal(req.headers.accept, 'application/json');
        assert.match(req.headers['user-agent']!, /^wixzel-voice\/\d/);
        assert.match(req.headers['x-wixzel-client']!, /^wixzel-voice-ts\/\d/);
        assert.equal(req.headers['content-type'], undefined);
        assert.equal(req.headers['wixzel-version'], undefined);
        assert.equal(client.keyMode, 'test');
        assert.equal(client.baseUrl, 'https://api.example');
    });

    test('pins the API version and merges default and per-call headers', async () => {
        const client = make({ apiVersion: '2026-09-01', defaultHeaders: { 'X-Team': 'ops' } });
        await client.engines.list({ headers: { 'X-Trace': 't1' } });
        const req = api.last();
        assert.equal(req.headers['wixzel-version'], '2026-09-01');
        assert.equal(req.headers['x-team'], 'ops');
        assert.equal(req.headers['x-trace'], 't1');
    });

    test('JSON-encodes bodies, sets content type, and encodes ids in paths', async () => {
        const client = make();
        await client.agents.update('a b/c', { name: 'Renamed' });
        const req = api.last();
        assert.equal(req.method, 'PATCH');
        assert.equal(req.path, '/v1/agents/a%20b%2Fc');
        assert.equal(req.headers['content-type'], 'application/json');
        assert.deepEqual(req.body, { name: 'Renamed' });
    });

    test('drops empty query values and stringifies the rest', async () => {
        const client = make();
        await client.calls.list({ limit: 5, failed_only: true, agent_id: undefined, status: undefined, phone_number: '' });
        assert.deepEqual(api.last().query, { limit: '5', failed_only: 'true' });
    });

    test('a 204 resolves to undefined', async () => {
        const client = make();
        api.queue.push({ status: 204 });
        assert.equal(await client.leads.delete('ld1'), undefined);
        assert.equal(api.last().method, 'DELETE');
    });

    test('response metadata rides along without changing the record', async () => {
        const client = make();
        api.queue.push({ status: 201, body: { id: 'c1', object: 'call' }, headers: { 'x-request-id': 'req_9', 'idempotent-replay': 'true' } });
        const call = await client.calls.create({ to: '+14155551234', agent_id: 'ag1' });
        assert.deepEqual(JSON.parse(JSON.stringify(call)), { id: 'c1', object: 'call' });
        assert.deepEqual(Object.keys(call), ['id', 'object']);
        const meta = lastResponse(call)!;
        assert.equal(meta.status, 201);
        assert.equal(meta.requestId, 'req_9');
        assert.equal(meta.idempotentReplay, true);
        assert.equal(lastResponse('a string'), undefined);
    });

    test('refuses to construct without a key', () => {
        assert.throws(() => new WixzelVoice({ apiKey: '' }), /apiKey is required/);
    });

    test('defaults to the api.voice host', () => {
        assert.equal(DEFAULT_BASE_URL, 'https://api.voice.wixzel.com');
        assert.equal(new WixzelVoice({ apiKey: 'wv_test_abc', fetch: api.fetchImpl }).baseUrl, DEFAULT_BASE_URL);
    });

    test('the pre-rename class name still works, as the same class', () => {
        // Code written against wixzel-phone 0.3.0 only has to change its import.
        const options: WixzelPhoneOptions = { apiKey: 'wv_test_abc', fetch: api.fetchImpl };
        const client: WixzelPhone = new WixzelPhone(options);
        assert.equal(WixzelPhone, WixzelVoice);
        assert.ok(client instanceof WixzelVoice);
    });

    test('the escape hatch reaches any path with the same conventions', async () => {
        const client = make();
        await client.request('POST', '/v1/future', { body: { a: 1 }, idempotent: true });
        const req = api.last();
        assert.equal(req.path, '/v1/future');
        assert.match(req.headers['idempotency-key']!, /^[0-9a-f-]{36}$/);
    });
});

describe('errors', () => {
    test('parses the envelope, doc_url, param, request id and the balance header', async () => {
        const client = make();
        api.queue.push({
            ...apiError(402, 'insufficient_credits', 'insufficient_credits', 'Balance too low.', { doc_url: 'https://docs.voice.wixzel.com/errors#insufficient_credits', param: 'to' }),
            headers: { 'x-wixzel-balance': '$0.12' },
        });
        await assert.rejects(client.calls.create({ to: '+14155551234', agent_id: 'ag1' }), (err: unknown) => {
            assert.ok(WixzelError.is(err));
            assert.equal(err.status, 402);
            assert.equal(err.type, 'insufficient_credits');
            assert.equal(err.code, 'insufficient_credits');
            assert.ok(err.is('insufficient_credits'));
            assert.equal(err.message, 'Balance too low.');
            assert.equal(err.param, 'to');
            assert.equal(err.requestId, 'req_test');
            assert.equal(err.docUrl, 'https://docs.voice.wixzel.com/errors#insufficient_credits');
            assert.equal(err.balance, '$0.12');
            assert.equal(err.retryAfter, null);
            return true;
        });
    });

    test('a non-JSON failure still becomes a WixzelError', async () => {
        const client = make({ maxRetries: 0 });
        api.queue.push({ status: 502, body: '<html>bad gateway</html>' });
        await assert.rejects(client.engines.list(), (err: unknown) => {
            assert.ok(WixzelError.is(err));
            assert.equal(err.status, 502);
            assert.equal(err.type, 'api_error');
            assert.equal(err.code, 'http_502');
            assert.match(err.message, /bad gateway/);
            return true;
        });
    });

    test('a 4xx is never retried', async () => {
        const client = make();
        api.queue.push(apiError(404, 'not_found_error', 'agent_not_found'));
        await assert.rejects(client.agents.retrieve('zzz'), (err: unknown) => WixzelError.is(err) && err.is('agent_not_found'));
        assert.equal(api.requests.length, 1);
    });

    test('a network failure on a non-repeatable request surfaces at once', async () => {
        const client = make();
        api.queue.push({ throws: new TypeError('fetch failed') });
        await assert.rejects(client.campaigns.start('cp1'), (err: unknown) => err instanceof WixzelConnectionError && err.cause instanceof TypeError);
        assert.equal(api.requests.length, 1);
    });
});
