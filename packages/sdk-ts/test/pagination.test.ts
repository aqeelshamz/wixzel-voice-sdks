import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WixzelVoice, Page } from '../src/index.js';
import { fakeFetch } from './helpers/fake-fetch.js';

const api = fakeFetch();
const client = new WixzelVoice({ apiKey: 'wv_live_abc', baseUrl: 'https://api.example', fetch: api.fetchImpl, sleep: api.sleep });

const page = (ids: string[], next: string | null) => ({
    status: 200,
    body: { object: 'list', data: ids.map((id) => ({ id, object: 'call' })), has_more: next !== null, next_cursor: next },
});

beforeEach(() => api.reset());

describe('pagination', () => {
    test('a list is a Page with data, hasMore and nextCursor', async () => {
        api.queue.push(page(['a', 'b'], 'cur1'));
        const first = await client.calls.list({ limit: 2, status: 'completed' });
        assert.ok(first instanceof Page);
        assert.deepEqual(first.data.map((c) => c.id), ['a', 'b']);
        assert.equal(first.hasMore, true);
        assert.equal(first.nextCursor, 'cur1');
        assert.deepEqual(api.last().query, { limit: '2', status: 'completed' });
    });

    test('for await walks every page, chaining starting_after and keeping the query', async () => {
        api.queue.push(page(['a', 'b'], 'cur1'), page(['c'], 'cur2'), page(['d'], null));
        const seen: string[] = [];
        for await (const call of await client.calls.list({ limit: 2, status: 'completed' })) seen.push(call.id);
        assert.deepEqual(seen, ['a', 'b', 'c', 'd']);
        assert.equal(api.requests.length, 3);
        assert.deepEqual(api.requests[1]!.query, { limit: '2', status: 'completed', starting_after: 'cur1' });
        assert.deepEqual(api.requests[2]!.query, { limit: '2', status: 'completed', starting_after: 'cur2' });
    });

    test('nextPage() returns null at the end and pages() yields each page', async () => {
        api.queue.push(page(['a'], 'cur1'), page(['b'], null));
        const first = await client.agents.list();
        const second = await first.nextPage();
        assert.ok(second);
        assert.equal(second.hasMore, false);
        assert.equal(await second.nextPage(), null);

        api.reset();
        api.queue.push(page(['a'], 'cur1'), page(['b'], null));
        const sizes: number[] = [];
        for await (const p of (await client.agents.list()).pages()) sizes.push(p.data.length);
        assert.deepEqual(sizes, [1, 1]);
    });

    test('auto-paging forward drops an ending_before the caller passed', async () => {
        api.queue.push(page(['a'], 'cur1'), page(['b'], null));
        const first = await client.leads.list({ ending_before: 'old' });
        assert.deepEqual(api.last().query, { ending_before: 'old' });
        await first.nextPage();
        assert.deepEqual(api.last().query, { starting_after: 'cur1' });
    });

    test('usage events and the ledger page too; engines and SIP logs do not', async () => {
        api.queue.push(page(['e1'], null));
        assert.ok((await client.usage.events({ session_id: 's1' })) instanceof Page);
        api.queue.push(page(['l1'], null));
        assert.ok((await client.billing.ledger()) instanceof Page);
        api.queue.push({ status: 200, body: { object: 'list', data: [], last_id: 7 } });
        const logs = await client.sipTrunks.logs('st1', { since_id: 3 });
        assert.equal(logs.last_id, 7);
        assert.deepEqual(api.last().query, { since_id: '3' });
    });
});
