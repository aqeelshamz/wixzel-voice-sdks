import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WixzelVoice, lastResponse } from '../src/index.js';
import { apiError, fakeFetch } from './helpers/fake-fetch.js';

const api = fakeFetch();
const client = new WixzelVoice({ apiKey: 'wv_live_abc', baseUrl: 'https://api.example', fetch: api.fetchImpl, sleep: api.sleep });

beforeEach(() => api.reset());

describe('idempotency', () => {
    test('calls.create and billing.createTopup send a generated key; other creates do not', async () => {
        await client.calls.create({ to: '+14155551234', agent_id: 'ag1' });
        assert.match(api.last().headers['idempotency-key']!, /^[0-9a-f-]{36}$/);

        await client.billing.createTopup({ amount_usd: 20 });
        assert.match(api.last().headers['idempotency-key']!, /^[0-9a-f-]{36}$/);

        await client.agents.create({ name: 'a', system_prompt: 'b', opening_message: 'c', voice: { realtime: { model: 'google/gemini-live' } } });
        assert.equal(api.last().headers['idempotency-key'], undefined);
    });

    test('an explicit key is sent verbatim and stays out of the body', async () => {
        await client.calls.create({ to: '+14155551234', agent_id: 'ag1' }, { idempotencyKey: 'order-42' });
        const req = api.last();
        assert.equal(req.headers['idempotency-key'], 'order-42');
        assert.deepEqual(req.body, { to: '+14155551234', agent_id: 'ag1' });
    });

    test('the same key is reused across a 429 retry', async () => {
        api.queue.push({ ...apiError(429, 'rate_limit_error', 'rate_limit_exceeded'), headers: { 'retry-after': '1' } }, { status: 201, body: { id: 'c1' } });
        await client.calls.create({ to: '+14155551234', agent_id: 'ag1' });
        assert.equal(api.requests.length, 2);
        assert.equal(api.requests[0]!.headers['idempotency-key'], api.requests[1]!.headers['idempotency-key']);
    });

    test('a replayed response is visible through lastResponse', async () => {
        api.queue.push({ status: 201, body: { id: 'c1' }, headers: { 'idempotent-replay': 'true' } });
        const call = await client.calls.create({ to: '+14155551234', agent_id: 'ag1' }, { idempotencyKey: 'k' });
        assert.equal(lastResponse(call)?.idempotentReplay, true);
        api.queue.push({ status: 201, body: { id: 'c2' } });
        const fresh = await client.calls.create({ to: '+14155551234', agent_id: 'ag1' });
        assert.equal(lastResponse(fresh)?.idempotentReplay, false);
    });

    test('a key over 255 characters is refused before any request', async () => {
        await assert.rejects(
            client.calls.create({ to: '+14155551234', agent_id: 'ag1' }, { idempotencyKey: 'x'.repeat(256) }),
            /1–255 characters/,
        );
        assert.equal(api.requests.length, 0);
    });
});
