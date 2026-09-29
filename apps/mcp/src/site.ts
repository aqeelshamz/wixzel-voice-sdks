/**
 * Where this server's console is, and which edition it serves.
 *
 * The hosted server and the npm package both talk to voice.wixzel.com, which is
 * the default. A self-hosted install runs this same process against the buyer's
 * own API: WIXZEL_CONSOLE_URL points every link at the buyer's console, and
 * WIXZEL_EDITION=selfhost keeps the guide from sending an agent to buy credit
 * that does not exist there.
 */

export const DEFAULT_CONSOLE_URL = 'https://voice.wixzel.com';

export function consoleUrl(env: NodeJS.ProcessEnv = process.env): string {
    return (env.WIXZEL_CONSOLE_URL || DEFAULT_CONSOLE_URL).replace(/\/+$/, '');
}

export function isSelfHosted(env: NodeJS.ProcessEnv = process.env): boolean {
    return String(env.WIXZEL_EDITION ?? '').trim().toLowerCase() === 'selfhost';
}
