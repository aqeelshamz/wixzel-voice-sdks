/**
 * The operating guide an agent reads before it touches the account. Served
 * as the server's `instructions`, as a resource, and reused by the prompts,
 * so there is one place to keep it true.
 *
 * Built from the environment. A self-hosted install has no prepaid balance and
 * no top-ups, and telling an agent to buy credit there would send it after a
 * checkout that does not exist. The hosted text is unchanged.
 */

import { consoleUrl, isSelfHosted } from './site.js';

export function buildGuide(env: NodeJS.ProcessEnv = process.env): string {
    const selfHosted = isSelfHosted(env);
    const site = consoleUrl(env);
    const intro = selfHosted
        ? `One API key, every voice engine, on your own server. ${site}`
        : `One API key, one prepaid credit balance, every voice engine. ${site}`;
    const money = selfHosted
        ? `- COST accrues per second while a call is live and is itemised in usage events.
  Nothing is charged on a self-hosted server; the figure estimates what the voice
  providers bill. Amounts are micro-USD: 1,000,000 = $1.00.`
        : `- CREDIT is a dollar balance. Cost accrues per second while a call is live and is
  itemised in usage events. Amounts are micro-USD: 1,000,000 = $1.00.`;
    const firstCall = selfHosted ? '5. place_call.' : '5. get_balance. Then place_call.';
    const spending = selfHosted
        ? `place_call and start_campaign make real phones ring, and the voice providers bill
for every minute. Confirm with the user before calling them, say what it will do, and
never retry one with a different idempotency_key: the same key returns the original
result, a new key is a second call.`
        : `place_call, start_campaign and create_topup spend money or make real phones ring.
Confirm with the user before calling them, say what it will do, and never retry one
with a different idempotency_key: the same key returns the original result, a new
key is a second call. create_topup returns a checkout URL that a human must open;
never try to pay.`;

    return `# Wixzel Voice, for AI agents

Wixzel Voice is the API and MCP server for building AI agents that place and answer
real phone calls over your own SIP trunk, or talk to people in web and mobile apps.
${intro}

## The mental model

- An AGENT is a prompt plus a voice engine (speech-to-text, LLM, text-to-speech,
  or one realtime model that does all three).
- A SIP TRUNK is the user's own carrier account (Twilio, Telnyx, Plivo, Vonage,
  Bandwidth, Exotel, Vobiz, any SIP provider). Wixzel does not sell numbers or
  minutes; the carrier's rates stay theirs.
- A PHONE NUMBER is a number the user owns at that carrier, registered on the trunk.
  Give it an inbound_agent_id and inbound calls are answered by that agent.
- A CALL connects an agent to a real phone over the trunk. Outbound calls are placed
  with place_call; campaigns place one call per lead.
${money}

## The order things go in

1. list_engines: see which models are available right now and what they cost.
   Never guess a model id.
2. create_sip_trunk with the user's carrier credentials, then tell the user to
   allowlist platform_ip with the carrier (outbound) and to point the carrier at
   origination_uri (inbound). check_sip_trunk_status shows whether it is reachable.
3. create_phone_number on that trunk.
4. create_agent with a short spoken-style system_prompt, an opening_message, and a
   voice from step 1. Set outbound_phone_number_id so calls have a caller id.
${firstCall}
6. get_call to watch status, read the transcript, and see cost_micros. If it did not
   connect, failure_code and failure_reason say why and what to do.

## Money and the real world

${spending}

Delete and revoke tools are permanent. revoke_api_key on the key this server is
using will cut this server off.

## Reading results

- Errors carry a machine-readable code; act on the code and the Hint line.
- Lists are cursor-paginated: pass next_cursor as starting_after until has_more is false.
- 404 means "not on this account", including records owned by someone else.
- The key's scopes decide what works. A permission error names the missing scope;
  the fix is a new key from Dashboard -> API keys, not a retry.

Docs: https://docs.voice.wixzel.com
`;
}

export const GUIDE = buildGuide();
