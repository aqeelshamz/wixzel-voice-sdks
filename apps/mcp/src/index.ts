#!/usr/bin/env node
/**
 * wixzel-voice-mcp
 *
 *   wixzel-voice-mcp                 stdio transport, key from WIXZEL_API_KEY
 *   wixzel-voice-mcp --http [port]   Streamable HTTP on /mcp; each request's
 *                                    Authorization: Bearer is the API key
 *
 * Environment:
 *   WIXZEL_API_KEY        wv_live_… or wv_test_… (required for stdio; a local-only fallback for --http)
 *   WIXZEL_API_BASE_URL   default https://api.voice.wixzel.com
 *   WIXZEL_API_VERSION    optional Wixzel-Version date pin
 *   MCP_PORT              --http port (default 3939)
 *   MCP_BIND              --http interface (default 127.0.0.1)
 *   MCP_PUBLIC_URL        the URL clients use, e.g. https://mcp.voice.wixzel.com/mcp
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_BASE_URL } from './client.js';
import { resolveHttpOptions, startHttp } from './http.js';
import { createServer, SERVER_VERSION } from './server.js';
import { consoleUrl } from './site.js';

const HELP = `wixzel-voice-mcp ${SERVER_VERSION}

Usage:
  wixzel-voice-mcp                Run over stdio (for Claude Code, Claude Desktop, Cursor…)
  wixzel-voice-mcp --http [port]  Run a Streamable HTTP server (default http://127.0.0.1:3939/mcp)
  wixzel-voice-mcp --help

Environment:
  WIXZEL_API_KEY       Your API key. Required for stdio. For --http it is only accepted on a loopback MCP_PUBLIC_URL.
  WIXZEL_API_BASE_URL  Defaults to ${DEFAULT_BASE_URL}
  WIXZEL_API_VERSION   Optional Wixzel-Version date pin, e.g. 2026-09-01
  MCP_PORT, MCP_BIND, MCP_PUBLIC_URL   --http settings; see README
`;

async function runStdio(): Promise<void> {
    const apiKey = process.env.WIXZEL_API_KEY;
    if (!apiKey) {
        process.stderr.write(
            'wixzel-voice-mcp: WIXZEL_API_KEY is not set.\n' +
                `Create a key at ${consoleUrl()}/connect and pass it as an environment variable.\n`,
        );
        process.exit(1);
    }
    const server = createServer({
        client: {
            apiKey,
            baseUrl: process.env.WIXZEL_API_BASE_URL || undefined,
            apiVersion: process.env.WIXZEL_API_VERSION || undefined,
        },
    });
    await server.connect(new StdioServerTransport());
    // stdout is the protocol channel; everything human goes to stderr.
    process.stderr.write(`wixzel-voice-mcp ${SERVER_VERSION} ready on stdio (${apiKey.slice(0, 8)}…)\n`);
}

async function runHttp(cliPort?: number): Promise<void> {
    const opts = resolveHttpOptions(process.env, cliPort);
    const running = await startHttp(opts);
    process.stderr.write(
        `wixzel-voice-mcp ${SERVER_VERSION} listening on http://${opts.bind}:${running.port}${new URL(opts.publicUrl).pathname}` +
            ` as ${opts.publicUrl}` +
            (opts.fallbackKey ? ' (WIXZEL_API_KEY fallback, loopback only)' : ' (bearer or OAuth required)') +
            '\n',
    );
    const shutdown = () => {
        void running.close().then(() => process.exit(0));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        process.stdout.write(HELP);
        return;
    }
    if (args.includes('--version') || args.includes('-v')) {
        process.stdout.write(`${SERVER_VERSION}\n`);
        return;
    }
    const httpIndex = args.indexOf('--http');
    if (httpIndex !== -1) {
        const explicit = args[httpIndex + 1];
        await runHttp(explicit && /^\d+$/.test(explicit) ? Number(explicit) : undefined);
        return;
    }
    await runStdio();
}

main().catch((error) => {
    process.stderr.write(`wixzel-voice-mcp: ${(error as Error).message}\n`);
    process.exit(1);
});
