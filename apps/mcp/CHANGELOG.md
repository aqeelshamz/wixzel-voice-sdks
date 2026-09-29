# Changelog

## 0.4.0 (2026-09-29)

Renamed from `wixzel-phone-mcp` to `wixzel-voice-mcp`, because the product is
called Wixzel Voice again. The tools and prompts are unchanged.

- Install and run `wixzel-voice-mcp` (`npx -y wixzel-voice-mcp`); the binary is
  `wixzel-voice-mcp` too. The server advertises itself as `wixzel-voice`, and
  the examples add it under that name, so its prompts appear as
  `/mcp__wixzel-voice__quickstart`. A connection already added as
  `wixzel-phone` keeps the name it was given.
- The default API base URL is now `https://api.voice.wixzel.com`, and the
  hosted server is `https://mcp.voice.wixzel.com/mcp`.
  `https://api.phone.wixzel.com` and `https://mcp.phone.wixzel.com/mcp` keep
  serving, so `wixzel-phone-mcp` 0.3.0 and earlier, and connectors added with
  the old address, keep working without a change.
- In HTTP mode on the hosted names, the protected-resource metadata and the
  `401` challenge name the host the client connected to. MCP clients refuse
  metadata for another origin, so this is what keeps a connector added as
  `mcp.phone.wixzel.com` able to sign in again.
- Requests send `User-Agent: wixzel-voice-mcp/0.4.0`. It said `0.2.1` through
  the 0.3.0 release; it now follows the package version.
- The operating guide the server sends as its instructions describes Wixzel
  Voice as the API and MCP server people build agents with, not as the agents.
- Carries what the official MCP Registry needs to list it as
  `com.wixzel/voice`: `mcpName` in `package.json`, and `server.json` in the
  source.

## 0.3.0

`create_realtime_session`: mint a one-minute, single-use client secret so a
web page or app can talk to an agent over `wss /v1/realtime`, with no SIP
trunk. Annotated as a write, not a spend — minting charges nothing; the
session bills when a client connects. 65 tools.

## 0.2.2

Five webhook tools: `get_webhook`, `update_webhook`, `rotate_webhook_secret`,
`test_webhook` and `list_webhook_deliveries`. The `webhooks:read` and
`webhooks:write` scopes were already in the scope list and reached nothing;
they now reach a real resource. 64 tools.

`test_webhook` is annotated as reaching the outside world — it POSTs to a
third-party endpoint — but it spends no credit.

## 0.2.1

Point `repository` at the public mirror, github.com/aqeelshamz/wixzel-phone-sdks. The 0.2.0 metadata named the private monorepo, so the link on the npm page did not resolve. No code changes.

## 0.2.0

Moved into the monorepo, added Streamable HTTP mode with OAuth discovery, protected-resource metadata and a token probe.

## 0.1.0

First release: 56 tools, three prompts, two resources, over stdio.
