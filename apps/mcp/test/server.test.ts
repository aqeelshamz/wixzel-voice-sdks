import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { createServer, allTools, WixzelClient, WixzelApiError, SERVER_NAME, SERVER_VERSION } from '../src/server.js';
import { USER_AGENT } from '../src/client.js';

/**
 * A fake Wixzel Voice API. Records every request so a test can assert on
 * method, path, query, headers and body, and answers with whatever the test
 * queued (or a generic echo when nothing was queued).
 */
interface Recorded {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: unknown;
}

function fakeApi() {
    const requests: Recorded[] = [];
    const queue: Array<{ status: number; body?: unknown; headers?: Record<string, string> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
        requests.push({
            method: init?.method ?? 'GET',
            path: url.pathname,
            query: Object.fromEntries(url.searchParams.entries()),
            headers,
            body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        const next = queue.shift() ?? { status: 200, body: { echoed: true, path: url.pathname } };
        if (next.status === 204) return new Response(null, { status: 204, headers: next.headers });
        return new Response(JSON.stringify(next.body ?? {}), {
            status: next.status,
            headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
        });
    };
    return { requests, queue, fetchImpl, last: () => requests[requests.length - 1]! };
}

describe('wixzel-voice-mcp', () => {
    const api = fakeApi();
    const client = new Client({ name: 'test', version: '0' });
    let server: ReturnType<typeof createServer>;

    before(async () => {
        server = createServer({
            client: new WixzelClient({ apiKey: 'wv_test_abc', baseUrl: 'https://api.example', fetch: api.fetchImpl }),
        });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        await client.connect(clientTransport);
    });

    beforeEach(() => {
        api.queue.length = 0;
    });

    after(async () => {
        await client.close();
        await server.close();
    });

    test('exposes one tool per API operation with annotations and unique names', async () => {
        const { tools } = await client.listTools();
        assert.equal(tools.length, allTools.length);
        assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
        for (const tool of tools) {
            assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a description`);
            assert.ok(tool.annotations, `${tool.name} needs annotations`);
            assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', `${tool.name} readOnlyHint`);
        }
        const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
        assert.ok(readOnly.includes('list_agents') && readOnly.includes('get_balance'));
        assert.ok(!readOnly.includes('place_call') && !readOnly.includes('delete_agent'));
        const spend = tools.filter((t) => t.annotations?.openWorldHint && !t.annotations?.readOnlyHint).map((t) => t.name);
        // Pinned deliberately: adding a tool that rings a phone, spends credit
        // or POSTs to somebody else's server should be a decision someone makes
        // here, not a side effect of an annotation copied from a neighbour.
        // test_sip_trunk and test_webhook reach a third party without spending.
        assert.deepEqual(spend.sort(), [
            'create_topup', 'place_call', 'start_campaign', 'test_call_agent',
            'test_sip_trunk', 'test_webhook',
        ]);
    });

    test('introduces itself as Wixzel Voice', () => {
        const info = client.getServerVersion();
        assert.equal(info?.name, 'wixzel-voice');
        assert.equal(info?.title, 'Wixzel Voice');
        assert.equal(info?.version, SERVER_VERSION);
        assert.match(client.getInstructions() ?? '', /^# Wixzel Voice, for AI agents/);
    });

    test('scope requirement is written into the description', async () => {
        const { tools } = await client.listTools();
        const placeCall = tools.find((t) => t.name === 'place_call')!;
        assert.match(placeCall.description!, /Requires scope `calls:write`/);
    });

    test('list tools pass pagination and filters as query params, with the bearer key', async () => {
        api.queue.push({ status: 200, body: { object: 'list', data: [], has_more: false, next_cursor: null } });
        const result = await client.callTool({
            name: 'list_calls',
            arguments: { limit: 5, status: 'completed', starting_after: 'abc' },
        });
        const req = api.last();
        assert.equal(req.method, 'GET');
        assert.equal(req.path, '/v1/calls');
        assert.deepEqual(req.query, { limit: '5', status: 'completed', starting_after: 'abc' });
        assert.equal(req.headers.authorization, 'Bearer wv_test_abc');
        assert.match(req.headers['user-agent']!, /^wixzel-voice-mcp\//);
        assert.equal(result.isError, undefined);
        const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
        assert.deepEqual(JSON.parse(text), { object: 'list', data: [], has_more: false, next_cursor: null });
    });

    test('place_call sends an Idempotency-Key automatically and honours a supplied one', async () => {
        api.queue.push({ status: 201, body: { id: 'c1', object: 'call', status: 'queued' } });
        await client.callTool({ name: 'place_call', arguments: { to: '+14155551234', agent_id: 'ag1' } });
        let req = api.last();
        assert.equal(req.method, 'POST');
        assert.equal(req.path, '/v1/calls');
        assert.match(req.headers['idempotency-key']!, /^[0-9a-f-]{36}$/);
        assert.deepEqual(req.body, { to: '+14155551234', agent_id: 'ag1' });

        api.queue.push({ status: 201, body: { id: 'c1' } });
        await client.callTool({
            name: 'place_call',
            arguments: { to: '+14155551234', agent_id: 'ag1', idempotency_key: 'my-key', metadata: { ref: 42 } },
        });
        req = api.last();
        assert.equal(req.headers['idempotency-key'], 'my-key');
        assert.deepEqual(req.body, { to: '+14155551234', agent_id: 'ag1', metadata: { ref: 42 } });
        assert.equal('idempotency_key' in (req.body as object), false);
    });

    test('update tools PATCH only the fields that were sent', async () => {
        api.queue.push({ status: 200, body: { id: 'ag1' } });
        await client.callTool({ name: 'update_agent', arguments: { id: 'ag1', name: 'Renamed' } });
        const req = api.last();
        assert.equal(req.method, 'PATCH');
        assert.equal(req.path, '/v1/agents/ag1');
        assert.deepEqual(req.body, { name: 'Renamed' });
    });

    test('create_agent validates the voice model format before calling the API', async () => {
        const before = api.requests.length;
        const result = await client.callTool({
            name: 'create_agent',
            arguments: {
                name: 'x',
                system_prompt: 'y',
                opening_message: 'z',
                voice: { stt: { model: 'not-a-provider-model' }, llm: { model: 'a/b' }, tts: { model: 'c/d' } },
            },
        });
        assert.equal(result.isError, true);
        assert.equal(api.requests.length, before, 'no request should have been made');
    });

    test('delete tools return a confirmation on 204', async () => {
        api.queue.push({ status: 204 });
        const result = await client.callTool({ name: 'delete_lead', arguments: { id: 'ld1' } });
        assert.equal(api.last().method, 'DELETE');
        assert.equal(api.last().path, '/v1/leads/ld1');
        const text = (result.content as Array<{ text: string }>)[0]!.text;
        assert.deepEqual(JSON.parse(text), { deleted: true, id: 'ld1' });
    });

    test('API errors come back as isError with code, request_id and a hint', async () => {
        api.queue.push({
            status: 402,
            body: {
                error: {
                    type: 'insufficient_credits',
                    code: 'insufficient_credits',
                    message: 'Balance too low.',
                    request_id: 'req_123',
                },
            },
            headers: { 'x-wixzel-balance': '$0.12' },
        });
        const result = await client.callTool({ name: 'place_call', arguments: { to: '+14155551234', agent_id: 'a' } });
        assert.equal(result.isError, true);
        const text = (result.content as Array<{ text: string }>)[0]!.text;
        assert.match(text, /402 \(insufficient_credits \/ insufficient_credits\): Balance too low\./);
        assert.match(text, /request_id: req_123/);
        assert.match(text, /Hint: .*\$0\.12/);

        api.queue.push({
            status: 403,
            body: { error: { type: 'permission_error', code: 'insufficient_scope', message: 'Missing scope.' } },
        });
        const denied = await client.callTool({ name: 'list_agents', arguments: {} });
        const deniedText = (denied.content as Array<{ text: string }>)[0]!.text;
        assert.match(deniedText, /`agents:read` scope/);
    });

    test('429 is retried after Retry-After and is invisible to the caller', async () => {
        api.queue.push({
            status: 429,
            body: { error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Too many.' } },
            headers: { 'retry-after': '0' },
        });
        api.queue.push({ status: 200, body: { object: 'balance', balance_micros: 5_000_000 } });
        const countBefore = api.requests.length;
        const result = await client.callTool({ name: 'get_balance', arguments: {} });
        assert.equal(result.isError, undefined);
        assert.equal(api.requests.length - countBefore, 2);
    });

    test('prompts and resources are listed and readable', async () => {
        const { prompts } = await client.listPrompts();
        assert.deepEqual(prompts.map((p) => p.name).sort(), ['diagnose_call', 'quickstart', 'spend_report']);
        const prompt = await client.getPrompt({ name: 'diagnose_call', arguments: { call_id: 'c99' } });
        const text = (prompt.messages[0]!.content as { text: string }).text;
        assert.match(text, /call c99/);

        const { resources } = await client.listResources();
        assert.deepEqual(resources.map((r) => r.uri).sort(), ['wixzel://connection', 'wixzel://guide']);
        const conn = await client.readResource({ uri: 'wixzel://connection' });
        const parsed = JSON.parse((conn.contents[0] as { text: string }).text);
        assert.equal(parsed.key_mode, 'test');
        assert.equal(parsed.base_url, 'https://api.example');
        assert.equal(JSON.stringify(conn).includes('wv_test_abc'), false, 'the key must never be exposed');
    });
});

describe('WixzelClient', () => {
    test('throws WixzelApiError with parsed fields on non-2xx', async () => {
        const api = fakeApi();
        api.queue.push({
            status: 404,
            body: { error: { type: 'not_found_error', code: 'not_found', message: 'Nope', request_id: 'r1' } },
        });
        const c = new WixzelClient({ apiKey: 'wv_live_x', fetch: api.fetchImpl });
        await assert.rejects(c.get('/v1/agents/zzz'), (err: unknown) => {
            assert.ok(err instanceof WixzelApiError);
            assert.equal(err.status, 404);
            assert.equal(err.code, 'not_found');
            assert.equal(err.requestId, 'r1');
            return true;
        });
        assert.equal(c.keyMode, 'live');
        assert.equal(c.baseUrl, 'https://api.voice.wixzel.com');
    });

    test('sends Wixzel-Version when configured and drops empty query values', async () => {
        const api = fakeApi();
        const c = new WixzelClient({ apiKey: 'k', apiVersion: '2026-09-01', fetch: api.fetchImpl });
        await c.get('/v1/agents', { limit: undefined, tag: '', search: 'bob' });
        assert.equal(api.last().headers['wixzel-version'], '2026-09-01');
        assert.deepEqual(api.last().query, { search: 'bob' });
    });
});

/**
 * One version, everywhere it is written down. The MCP Registry refuses a
 * server.json whose npm package does not carry the same mcpName, and a
 * User-Agent that lags the release misfiles every request in the API's logs.
 */
describe('release metadata', () => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const pkg = read('package.json');
    const registry = read('server.json');

    test('package.json, server.json, the server and the User-Agent agree', () => {
        assert.equal(pkg.name, 'wixzel-voice-mcp');
        assert.equal(pkg.version, SERVER_VERSION);
        assert.equal(SERVER_NAME, 'wixzel-voice');
        assert.equal(USER_AGENT, `wixzel-voice-mcp/${SERVER_VERSION}`);
        assert.deepEqual(Object.keys(pkg.bin), ['wixzel-voice-mcp']);
        assert.equal(registry.version, SERVER_VERSION);
        assert.equal(registry.name, pkg.mcpName);
        assert.equal(registry.name, 'com.wixzel/voice');
    });

    test('server.json lists the npm package and the hosted remote', () => {
        assert.ok(registry.description.length <= 100, 'the registry caps descriptions at 100 characters');
        assert.equal(registry.repository.url, 'https://github.com/aqeelshamz/wixzel-voice-sdks');
        assert.equal(registry.repository.subfolder, 'apps/mcp');
        assert.equal(registry.packages.length, 1);
        const [npm] = registry.packages;
        assert.equal(npm.registryType, 'npm');
        assert.equal(npm.identifier, pkg.name);
        assert.equal(npm.version, pkg.version);
        assert.deepEqual(npm.transport, { type: 'stdio' });
        const key = npm.environmentVariables.find((v: { name: string }) => v.name === 'WIXZEL_API_KEY');
        assert.equal(key.isRequired, true);
        assert.equal(key.isSecret, true);
        assert.deepEqual(registry.remotes, [{ type: 'streamable-http', url: 'https://mcp.voice.wixzel.com/mcp' }]);
    });
});
