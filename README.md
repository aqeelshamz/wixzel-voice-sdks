# Wixzel Voice SDKs

[![npm](https://img.shields.io/npm/v/wixzel-voice?style=flat-square&logo=npm&logoColor=white&label=npm&color=A0D425&labelColor=0D0D0D)](https://www.npmjs.com/package/wixzel-voice)
[![pub.dev](https://img.shields.io/pub/v/wixzel_voice?style=flat-square&logo=dart&logoColor=white&label=pub.dev&color=A0D425&labelColor=0D0D0D)](https://pub.dev/packages/wixzel_voice)
[![npm](https://img.shields.io/npm/v/wixzel-voice-mcp?style=flat-square&logo=npm&logoColor=white&label=npm&color=A0D425&labelColor=0D0D0D)](https://www.npmjs.com/package/wixzel-voice-mcp)
[![MIT](https://img.shields.io/badge/licence-MIT-A0D425?style=flat-square&labelColor=0D0D0D)](LICENSE)

Public source for the packages [Wixzel Voice](https://voice.wixzel.com) publishes, for building AI agents that place and answer real phone calls over your own SIP trunk.

| Package | Registry | Source |
|---|---|---|
| `wixzel-voice` | [npm](https://www.npmjs.com/package/wixzel-voice) | [`packages/sdk-ts`](packages/sdk-ts) |
| `wixzel_voice` | [pub.dev](https://pub.dev/packages/wixzel_voice) | [`packages/sdk-dart`](packages/sdk-dart) |
| `wixzel-voice-mcp` | [npm](https://www.npmjs.com/package/wixzel-voice-mcp) | [`apps/mcp`](apps/mcp) |

Up to 0.3.0 these were published as `wixzel-phone`, `wixzel_phone` and `wixzel-phone-mcp`. Those versions keep working; each package's changelog says what to change to move across.

The two SDKs cover every `/v1` endpoint under one shared method table, page through cursor lists, send idempotency keys on the paths that spend money, retry rate limits honouring `Retry-After`, and raise errors carrying the API's stable `code`, `request_id` and `doc_url`. The MCP server puts the same surface in front of Claude Code, claude.ai and Claude Desktop.

- Documentation: [docs.voice.wixzel.com/sdks](https://docs.voice.wixzel.com/sdks) and [/mcp-server](https://docs.voice.wixzel.com/mcp-server)
- API reference: [docs.voice.wixzel.com/api-reference](https://docs.voice.wixzel.com/api-reference)

## Running the tests

`docs/openapi.json` is the API's own OpenAPI document, copied here because each package's coverage test reads it and asserts that every operation has a method and every method names a real operation.

```bash
npm install
npm test                       # the TypeScript SDK and the MCP server
cd packages/sdk-dart && dart test
```

## About this repository

This is a **mirror**. The packages are developed in the Wixzel Voice monorepo alongside the API they wrap, so that a change to an endpoint and the change to its client land together, and are synced here on release.

Issues and pull requests are welcome and are read. A pull request will be applied upstream and appear here on the next sync rather than merged directly, so it may arrive under a different commit.

## Licence

MIT for everything in this repository. Wixzel Voice itself is a hosted service; see [voice.wixzel.com](https://voice.wixzel.com) for its terms.
