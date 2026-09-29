# wixzel-voice

[![npm](https://img.shields.io/npm/v/wixzel-voice?style=flat-square&logo=npm&logoColor=white&label=npm&color=A0D425&labelColor=0D0D0D)](https://www.npmjs.com/package/wixzel-voice)
[![pub.dev](https://img.shields.io/pub/v/wixzel_voice?style=flat-square&logo=dart&logoColor=white&label=pub.dev&color=A0D425&labelColor=0D0D0D)](https://pub.dev/packages/wixzel_voice)
[![MIT](https://img.shields.io/badge/licence-MIT-A0D425?style=flat-square&labelColor=0D0D0D)](LICENSE)

The official TypeScript and JavaScript SDK for the [Wixzel Voice](https://voice.wixzel.com) API: build AI agents that place and answer real phone calls over your own SIP trunk. One API key, one prepaid balance, every voice engine.

- Every `/v1` endpoint as a typed method, with types generated from the same OpenAPI document that validates the API.
- Cursor pagination you can `for await`.
- Automatic idempotency keys on the two paths that spend money, so a retried timeout never dials twice.
- Retries on rate limits (honouring `Retry-After`) and on transient failures, only where a retry is safe.
- Errors that carry the API's stable `code`, the `request_id` to quote, and the `doc_url` to read.
- No dependencies. Node 20+, browsers, and edge runtimes with `fetch`.

```bash
npm install wixzel-voice
```

Up to 0.3.0 this package was published as `wixzel-phone`. To move across, install `wixzel-voice` and change the import; `WixzelPhone` still works as a deprecated alias of `WixzelVoice`. See the [changelog](CHANGELOG.md).

## Quickstart

```ts
import { WixzelVoice } from 'wixzel-voice';

const client = new WixzelVoice({ apiKey: process.env.WIXZEL_API_KEY! });

// What can the platform serve right now, and at what price?
const engines = await client.engines.list();

const agent = await client.agents.create({
  name: 'Support',
  system_prompt: 'You are a concise support agent.',
  opening_message: 'Hi, how can I help?',
  voice: {
    stt: { model: 'deepgram/nova-3' },
    llm: { model: 'openrouter/gpt-4o-mini' },
    tts: { model: 'elevenlabs/eleven_turbo_v2_5' },
  },
});

// Spends credit and rings a real phone. An Idempotency-Key is generated for you.
const call = await client.calls.create({ to: '+14155551234', agent_id: agent.id });

const detail = await client.calls.retrieve(call.id);
console.log(detail.status, detail.cost_micros, detail.transcript);
```

## Pagination

Every list returns a `Page`. Iterate it to walk every page; the cursor and your query are carried along.

```ts
for await (const call of await client.calls.list({ status: 'completed', limit: 100 })) {
  console.log(call.id, call.duration_seconds);
}

// Or page by page
let page = await client.leads.list({ tag: 'clinic' });
while (page) {
  console.log(page.data.length, page.hasMore);
  page = await page.nextPage();
}
```

## Errors

Match on `code`; the message may be reworded.

```ts
import { WixzelError, WixzelConnectionError } from 'wixzel-voice';

try {
  await client.calls.create({ to, agent_id });
} catch (err) {
  if (WixzelError.is(err)) {
    if (err.is('insufficient_credits')) console.log('balance:', err.balance);
    console.log(err.status, err.code, err.requestId, err.docUrl);
  } else if (err instanceof WixzelConnectionError) {
    // Never got an answer, even after retries. Retrying a keyed request is safe.
  }
}
```

## Idempotency

`calls.create` and `billing.createTopup` require an `Idempotency-Key`; the SDK generates one per call and reuses it across its own retries. Pass your own to make a retry from your side safe too, and read `Idempotent-Replay` through `lastResponse`:

```ts
import { lastResponse } from 'wixzel-voice';

const call = await client.calls.create({ to, agent_id }, { idempotencyKey: `order-${orderId}` });
if (lastResponse(call)?.idempotentReplay) console.log('the server had already placed this call');
```

## Retries

- `429`: retried after `Retry-After` (capped at 10 s), up to `maxRetries` (default 2). Rate-limited requests are never charged.
- Network failures, timeouts and `502`–`504`: retried only for `GET` and for requests carrying an idempotency key. `DELETE`, `PATCH` and unkeyed `POST` (hang up, start, pause, test, rotate) are never repeated on an ambiguous failure.
- `500` and other `4xx`: never retried.

## Pinning a version

```ts
const client = new WixzelVoice({ apiKey, apiVersion: '2026-09-01' });
```

Sends `Wixzel-Version` so an upgrade is something you do rather than something that happens to you.

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | required | `wv_live_…` or `wv_test_…` |
| `baseUrl` | `https://api.voice.wixzel.com` | For a self-hosted API |
| `apiVersion` | none | `Wixzel-Version` date pin |
| `timeoutMs` | 30000 | Per attempt |
| `maxRetries` | 2 | Retries after the first attempt |
| `fetch` | global | Bring your own |
| `defaultHeaders` | none | Sent on every request |

Every method takes a final `RequestOptions` argument: `idempotencyKey`, `signal`, `headers`, `maxRetries`.

`client.request(method, path, init)` reaches any endpoint the SDK does not model yet, with the same auth, retry and error handling.

## Browsers

The SDK runs in browsers, but the API's CORS policy does not expose `Retry-After`, `X-Wixzel-Balance` or `Idempotent-Replay` to page scripts yet, so `retryAfter`, `balance` and `idempotentReplay` read as empty there. Keep secret keys on a server.

## Related

- [Documentation](https://docs.voice.wixzel.com/sdks) · [API reference](https://docs.voice.wixzel.com/api-reference)
- [Source](https://github.com/aqeelshamz/wixzel-voice-sdks), where issues and pull requests are read. The SDK is developed in the private monorepo that also holds the API, so a change to an endpoint and the change to its client land together, and is mirrored here on release.
- [`wixzel_voice`](https://pub.dev/packages/wixzel_voice), the same SDK for Dart and Flutter
- [`wixzel-voice-mcp`](https://www.npmjs.com/package/wixzel-voice-mcp), the MCP server for Claude Code and claude.ai

MIT.
