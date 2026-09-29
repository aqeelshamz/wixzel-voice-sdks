import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WixzelClient, type WixzelClientOptions } from './client.js';
import { GUIDE } from './guide.js';
import { registerPrompts } from './prompts.js';
import { toolsFor } from './tools/index.js';
import { consoleUrl } from './site.js';
import { registerTools } from './tooling.js';
import { VERSION } from './version.js';

export const SERVER_NAME = 'wixzel-voice';
export const SERVER_VERSION = VERSION;

export interface CreateServerOptions {
    /** An already-constructed client, or the options to build one. */
    client: WixzelClient | WixzelClientOptions;
}

/**
 * Build an MCP server bound to one Wixzel Voice API key. Cheap enough to
 * construct per request in HTTP mode, where the key arrives with each call.
 */
export function createServer(opts: CreateServerOptions): McpServer {
    const client = opts.client instanceof WixzelClient ? opts.client : new WixzelClient(opts.client);

    const server = new McpServer(
        {
            name: SERVER_NAME,
            version: SERVER_VERSION,
            title: 'Wixzel Voice',
            websiteUrl: consoleUrl(),
            // Shown by clients that render a connector icon (claude.ai does).
            icons: [
                { src: `${consoleUrl()}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
                { src: `${consoleUrl()}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] },
            ],
        },
        {
            instructions: GUIDE,
            capabilities: { tools: {}, prompts: {}, resources: {} },
        },
    );

    registerTools(server, client, toolsFor());
    registerPrompts(server);

    server.registerResource(
        'guide',
        'wixzel://guide',
        {
            title: 'Wixzel Voice operating guide',
            description: 'How the pieces fit together, the order to set them up in, and which tools spend money.',
            mimeType: 'text/markdown',
        },
        async (uri) => ({
            contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE }],
        }),
    );

    server.registerResource(
        'connection',
        'wixzel://connection',
        {
            title: 'Current connection',
            description: 'Which API base URL this server talks to and whether the key is live or test. Never includes the key.',
            mimeType: 'application/json',
        },
        async (uri) => ({
            contents: [
                {
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify(
                        { base_url: client.baseUrl, key_mode: client.keyMode, tools: toolsFor().length },
                        null,
                        2,
                    ),
                },
            ],
        }),
    );

    return server;
}

export { WixzelClient, WixzelApiError } from './client.js';
export { allTools } from './tools/index.js';
export { GUIDE } from './guide.js';
