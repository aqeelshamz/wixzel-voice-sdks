# wixzel-voice-mcp

[![npm](https://img.shields.io/npm/v/wixzel-voice-mcp?style=flat-square&logo=npm&logoColor=white&label=npm&color=A0D425&labelColor=0D0D0D)](https://www.npmjs.com/package/wixzel-voice-mcp)
[![MIT](https://img.shields.io/badge/licence-MIT-A0D425?style=flat-square&labelColor=0D0D0D)](LICENSE)
**Wixzel Voice for AI agents.** A [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude Code, claude.ai, Claude Desktop, Cursor, and any other MCP client create voice agents, connect a carrier, place calls, run campaigns, and read what it all cost, using the [Wixzel Voice](https://voice.wixzel.com) API.

> Wixzel Voice: APIs for AI voice agents. One API key, one balance, every voice engine.

One tool per API operation, 56 in all, each annotated so a client knows which are read-only, which delete, and which **spend money or make a real phone ring**. Three prompts (`quickstart`, `diagnose_call`, `spend_report`) package the common workflows.

Published as `wixzel-phone-mcp` up to 0.3.0, while the product was briefly called Wixzel Phone. Those releases keep working: `api.phone.wixzel.com` and `mcp.phone.wixzel.com` keep serving.

Two ways to run it:

| | Where | Auth |
|---|---|---|
| **Hosted**, `https://mcp.voice.wixzel.com/mcp` | Wixzel's servers | OAuth sign-in from the client, or a bearer key |
| **Local**, `npx -y wixzel-voice-mcp` | Your machine, stdio | `WIXZEL_API_KEY` in the environment |

The console's **AI clients** page at [voice.wixzel.com/connect](https://voice.wixzel.com/connect) generates every command below with a key filled in.

## Claude Code

```bash
# hosted: sign in with your Wixzel account when Claude Code asks (/mcp → Authenticate)
claude mcp add --transport http wixzel-voice https://mcp.voice.wixzel.com/mcp

# local: a scoped key from the console
claude mcp add wixzel-voice -e WIXZEL_API_KEY=wv_live_... -- npx -y wixzel-voice-mcp
```

Or commit a `.mcp.json` so every collaborator gets it:

```json
{
  "mcpServers": {
    "wixzel-voice": {
      "command": "npx",
      "args": ["-y", "wixzel-voice-mcp"],
      "env": { "WIXZEL_API_KEY": "${WIXZEL_API_KEY}" }
    }
  }
}
```

Then:

```
/mcp__wixzel-voice__quickstart
```

## claude.ai and Claude Desktop

Settings → Connectors → Add custom connector → `https://mcp.voice.wixzel.com/mcp` → Connect. You sign in to the console, tick what the client may do, and it receives a scoped key of its own. Disconnect it from the console's AI clients page at any time.

## Cursor, Windsurf, VS Code, others

Same shape as `.mcp.json` above: command `npx`, args `["-y", "wixzel-voice-mcp"]`, env `WIXZEL_API_KEY`. Clients that connect over HTTP but cannot do OAuth send the key as `Authorization: Bearer wv_live_...`.

## What the agent can do

| Family | Tools |
|---|---|
| Engines | `list_engines` |
| Agents | `list_agents` `get_agent` `create_agent` `update_agent` `delete_agent` |
| Calls | `place_call` `list_calls` `get_call` `get_call_transcript` `hangup_call` `delete_call` |
| SIP trunks | `list_sip_trunks` `get_sip_trunk` `create_sip_trunk` `update_sip_trunk` `delete_sip_trunk` `check_sip_trunk_status` `test_sip_trunk` `get_sip_trunk_logs` |
| Phone numbers | `list_phone_numbers` `get_phone_number` `create_phone_number` `update_phone_number` `delete_phone_number` |
| Leads | `list_leads` `get_lead` `create_lead` `update_lead` `delete_lead` `import_leads` |
| Campaigns | `list_campaigns` `get_campaign` `create_campaign` `start_campaign` `pause_campaign` `delete_campaign` |
| Knowledge bases | `list_knowledge_bases` `get_knowledge_base` `create_knowledge_base` `update_knowledge_base` `delete_knowledge_base` |
| Appointments | `list_appointments` `get_appointment` `create_appointment` `update_appointment` `delete_appointment` |
| Billing & usage | `get_balance` `list_ledger_entries` `create_topup` `get_usage_summary` `list_usage_events` |
| API keys | `list_api_keys` `create_api_key` `rotate_api_key` `revoke_api_key` |

Prompts: `quickstart` (connect a carrier, register a number, build an agent, place a first call), `diagnose_call` (why did call X fail), `spend_report` (what did this month cost, and where).

Resources: `wixzel://guide` (the operating guide the server also sends as its instructions) and `wixzel://connection` (base URL and whether the key is live or test; never the key itself).

## How it keeps the agent honest

- **Money is explicit.** `place_call`, `start_campaign` and `create_topup` are annotated `openWorldHint: true` and their descriptions tell the model to confirm with the user first. Clients that gate on annotations will ask before running them.
- **Idempotency is automatic.** The two money paths require an `Idempotency-Key`; the server generates one per call and accepts an explicit `idempotency_key` for deliberate retries, so a network timeout never turns into two calls.
- **Errors are actionable.** Every failure returns the API's machine-readable `code`, the `request_id`, and a hint that says what to do: which scope is missing, that the balance is short, that a cursor was mangled.
- **Rate limits are absorbed.** A `429` is retried after `Retry-After` up to twice before the model sees it. Those requests are never charged.
- **Scopes do the gating.** The key decides what works. There is no admin scope, and a key cannot create one broader than itself.
- **Secrets stay put.** SIP passwords are write-only; API key secrets appear once, in the tool result, and nowhere else. The key this server runs with is never exposed through any tool or resource.

## Running the hosted mode yourself

```bash
npx wixzel-voice-mcp --http 3939
```

| Variable | Purpose |
|---|---|
| `MCP_PORT` | Port. Default 3939; `--http <port>` overrides. |
| `MCP_BIND` | Interface. Default `127.0.0.1`; terminate TLS in front rather than binding wider. |
| `MCP_PUBLIC_URL` | The URL clients use, e.g. `https://mcp.voice.wixzel.com/mcp`. Advertised as the OAuth resource. |
| `WIXZEL_API_BASE_URL` | The API, which is also the OAuth authorization server. Default `https://api.voice.wixzel.com`. |
| `WIXZEL_API_VERSION` | Optional `Wixzel-Version` date pin. |
| `WIXZEL_API_KEY` | Stdio mode: the key. HTTP mode: a fallback for requests without a bearer, **accepted only when `MCP_PUBLIC_URL` is a loopback address**. |

Each request's bearer becomes the API key for a fresh, throwaway MCP server; nothing is shared between requests. A request without a bearer gets a `401` with `WWW-Authenticate: Bearer resource_metadata="…"`, and `/.well-known/oauth-protected-resource` names the API as the authorization server, which is how connectors discover sign-in on their own. `GET /healthz` reports liveness.

## Development

The source is mirrored at [wixzel-voice-sdks](https://github.com/aqeelshamz/wixzel-voice-sdks); it is developed in the private monorepo that also holds the API, so a change to an endpoint and the change to its tool land together.

```bash
npm install                # at the repo root
npm test -w apps/mcp       # offline: a fake API behind in-memory and HTTP transports, plus a spec-coverage check
npm run build -w apps/mcp
npm run inspect -w apps/mcp   # MCP Inspector against the built server
```

Tool schemas are hand-written zod. The spec-coverage test compares them against the API's OpenAPI document (`docs/openapi.json`) in both directions, so an endpoint added to the API fails the build here until it gets a tool.

## Not for application code

This server is for AI agents. Application code should use the SDKs:
[`wixzel-voice`](https://www.npmjs.com/package/wixzel-voice) on npm and
[`wixzel_voice`](https://pub.dev/packages/wixzel_voice) on pub.dev.

## License

MIT. Wixzel Voice itself is a hosted service; see [voice.wixzel.com](https://voice.wixzel.com) for terms.
