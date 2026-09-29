import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WixzelVoice, WixzelError, WixzelConnectionError } from '../src/index.js';
import { apiError, fakeFetch } from './helpers/fake-fetch.js';

const api = fakeFetch();
const make = (opts: Partial<ConstructorParameters<typeof WixzelVoice>[0]> = {}) =>
    new WixzelVoice({ apiKey: 'wv_live_abc', baseUrl: 'https://api.example', fetch: api.fetchImpl, sleep: api.sleep, ...opts });

const limited = (retryAfter?: string) => ({
    ...apiError(429, 'rate_limit_error', 'rate_limit_exceeded', 'Too many requests.'),
    headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
});

beforeEach(() => api.reset());

describe('retries', () => {
    test('a 429 is retried after Retry-After, capped at ten seconds', async () => {
        const client = make();
        api.queue.push(limited('2'), limited('60'), { status: 200, body: { object: 'balance' } });
        const balance = await client.billing.balance();
        assert.equal(balance.object, 'balance');
        assert.equal(api.requests.length, 3);
        assert.deepEqual(api.sleeps, [2000, 10_000]);
    });

    test('without Retry-After the wait backs off exponentially with jitter', async () => {
        const client = make();
        api.queue.push(limited(), limited(), { status: 200, body: {} });
        await client.billing.balance();
        assert.equal(api.sleeps.length, 2);
        assert.ok(api.sleeps[0]! >= 375 && api.sleeps[0]! <= 625, `first backoff ${api.sleeps[0]}`);
        assert.ok(api.sleeps[1]! >= 750 && api.sleeps[1]! <= 1250, `second backoff ${api.sleeps[1]}`);
    });

    test('gives up after maxRetries and throws the last error with retryAfter', async () => {
        const client = make({ maxRetries: 1 });
        api.queue.push(limited('3'), limited('4'));
        await assert.rejects(client.billing.balance(), (err: unknown) => {
            assert.ok(WixzelError.is(err));
            assert.equal(err.status, 429);
            assert.equal(err.retryAfter, 4);
            return true;
        });
        assert.equal(api.requests.length, 2);
    });

    test('a per-call maxRetries overrides the client', async () => {
        const client = make({ maxRetries: 5 });
        api.queue.push(limited('1'), limited('1'));
        await assert.rejects(client.billing.balance({ maxRetries: 0 }));
        assert.equal(api.requests.length, 1);
    });

    test('a 503 is retried on a GET but not on an unkeyed POST', async () => {
        const client = make();
        api.queue.push(apiError(503, 'api_error', 'engine_unavailable'), { status: 200, body: { object: 'list', data: [] } });
        await client.engines.list();
        assert.equal(api.requests.length, 2);

        api.reset();
        api.queue.push(apiError(503, 'api_error', 'engine_unavailable'));
        await assert.rejects(client.campaigns.start('cp1'), (err: unknown) => WixzelError.is(err) && err.status === 503);
        assert.equal(api.requests.length, 1);
    });

    test('a 503 on a keyed POST is retried with the same key', async () => {
        const client = make();
        api.queue.push(apiError(503, 'api_error', 'engine_unavailable'), { status: 201, body: { id: 'c1' } });
        await client.calls.create({ to: '+14155551234', agent_id: 'ag1' });
        assert.equal(api.requests.length, 2);
        assert.equal(api.requests[0]!.headers['idempotency-key'], api.requests[1]!.headers['idempotency-key']);
    });

    test('a 500 is never retried', async () => {
        const client = make();
        api.queue.push(apiError(500, 'api_error', 'internal_error'));
        await assert.rejects(client.engines.list(), (err: unknown) => WixzelError.is(err) && err.status === 500);
        assert.equal(api.requests.length, 1);
    });

    test('a network failure on a GET is retried, then becomes a connection error', async () => {
        const client = make();
        api.queue.push({ throws: new TypeError('fetch failed') }, { throws: new TypeError('fetch failed') }, { throws: new TypeError('fetch failed') });
        await assert.rejects(client.engines.list(), (err: unknown) => {
            assert.ok(err instanceof WixzelConnectionError);
            assert.match(err.message, /after 3 attempt/);
            return true;
        });
        assert.equal(api.requests.length, 3);
    });

    test('an abort from the caller is not retried and is thrown as-is', async () => {
        const client = make();
        const controller = new AbortController();
        controller.abort();
        api.queue.push({ throws: new DOMException('aborted', 'AbortError') });
        await assert.rejects(client.engines.list({ signal: controller.signal }), (err: unknown) => err instanceof DOMException);
        assert.equal(api.requests.length, 1);
    });
});
