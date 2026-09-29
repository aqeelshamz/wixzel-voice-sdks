import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildGuide, GUIDE } from '../src/guide.js';
import { resolveHttpOptions, startHttp } from '../src/http.js';
import { consoleUrl, isSelfHosted } from '../src/site.js';
import { allTools, toolsFor } from '../src/tools/index.js';

/**
 * The same MCP server runs on voice.wixzel.com and on a buyer's own server. On
 * the second, every link has to point at the buyer's console, and nothing may
 * tell an agent to buy credit, because there is none to buy.
 */

describe('the console URL', () => {
    test('defaults to the hosted console', () => {
        assert.equal(consoleUrl({}), 'https://voice.wixzel.com');
    });

    test('follows WIXZEL_CONSOLE_URL, without a trailing slash', () => {
        assert.equal(consoleUrl({ WIXZEL_CONSOLE_URL: 'https://voice.acme.test/' }), 'https://voice.acme.test');
    });

    test('recognises a self-hosted install', () => {
        assert.equal(isSelfHosted({ WIXZEL_EDITION: 'selfhost' }), true);
        assert.equal(isSelfHosted({}), false);
    });
});

describe('the operating guide', () => {
    test('describes the product as what people build with, not as the agents', () => {
        for (const guide of [buildGuide({}), buildGuide({ WIXZEL_EDITION: 'selfhost' })]) {
            assert.match(guide, /^# Wixzel Voice, for AI agents/);
            assert.match(guide, /Wixzel Voice is the API and MCP server for building AI agents that place and answer\nreal phone calls over your own SIP trunk, or talk to people in web and mobile apps\./);
            assert.doesNotMatch(guide, /AI voice agents that make and take/);
            assert.doesNotMatch(guide, /Wixzel Phone/);
        }
    });

    test('the hosted guide still sends agents to top up', () => {
        const hosted = buildGuide({});
        assert.equal(hosted, GUIDE, 'the process in this test is not self-hosted');
        assert.match(hosted, /one prepaid credit balance/);
        assert.match(hosted, /create_topup returns a checkout URL/);
        assert.match(hosted, /5\. get_balance\. Then place_call\./);
        assert.match(hosted, /https:\/\/voice\.wixzel\.com/);
        assert.match(hosted, /Docs: https:\/\/docs\.voice\.wixzel\.com/);
    });

    test('a self-hosted guide mentions no credit and links to the buyer console', () => {
        const own = buildGuide({ WIXZEL_EDITION: 'selfhost', WIXZEL_CONSOLE_URL: 'https://voice.acme.test' });
        assert.doesNotMatch(own, /create_topup/);
        assert.doesNotMatch(own, /prepaid/);
        assert.doesNotMatch(own, /get_balance/);
        // The public docs still apply to a self-hosted install; the console link must not point at ours.
        assert.doesNotMatch(own, /https:\/\/voice\.wixzel\.com/);
        assert.match(own, /https:\/\/voice\.acme\.test/);
        assert.match(own, /Nothing is charged on a self-hosted server/);
    });
});

describe('the landing page on a self-hosted install', () => {
    test('resolveHttpOptions carries the console URL', () => {
        assert.equal(resolveHttpOptions({}).consoleUrl, 'https://voice.wixzel.com');
        assert.equal(resolveHttpOptions({ WIXZEL_CONSOLE_URL: 'https://voice.acme.test' }).consoleUrl, 'https://voice.acme.test');
    });

    test('links to the buyer console and shows the buyer MCP URL', async () => {
        const running = await startHttp({
            port: 0,
            bind: '127.0.0.1',
            publicUrl: 'https://mcp.voice.acme.test/mcp',
            apiBaseUrl: 'https://api.voice.acme.test',
            consoleUrl: 'https://voice.acme.test',
            fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
            log: () => undefined,
        });
        try {
            const html = await (await fetch(`http://127.0.0.1:${running.port}/`)).text();
            assert.match(html, /claude mcp add --transport http wixzel-voice https:\/\/mcp\.voice\.acme\.test\/mcp/);
            assert.match(html, /href="https:\/\/voice\.acme\.test\/connect"/);
            assert.doesNotMatch(html, /voice\.wixzel\.com\/connect/);
            assert.doesNotMatch(html, /solutions\/ai-agents-mcp/, 'no product links on a buyer\'s server');
        } finally {
            await running.close();
        }
    });
});

describe('the tools, per edition', () => {
    test('the hosted server registers every tool', () => {
        assert.equal(toolsFor({}).length, allTools.length);
    });

    test('a self-hosted server has no top-up tool and nothing else missing', () => {
        const names = toolsFor({ WIXZEL_EDITION: 'selfhost' }).map((tool) => tool.name);
        assert.ok(!names.includes('create_topup'));
        assert.equal(names.length, allTools.length - 1);
    });
});
