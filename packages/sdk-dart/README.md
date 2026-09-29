# wixzel_voice

[![pub.dev](https://img.shields.io/pub/v/wixzel_voice?style=flat-square&logo=dart&logoColor=white&label=pub.dev&color=A0D425&labelColor=0D0D0D)](https://pub.dev/packages/wixzel_voice)
[![npm](https://img.shields.io/npm/v/wixzel-voice?style=flat-square&logo=npm&logoColor=white&label=npm&color=A0D425&labelColor=0D0D0D)](https://www.npmjs.com/package/wixzel-voice)
[![MIT](https://img.shields.io/badge/licence-MIT-A0D425?style=flat-square&labelColor=0D0D0D)](LICENSE)

The official Dart SDK for the [Wixzel Voice](https://voice.wixzel.com) API: build AI agents that place and answer real phone calls over your own SIP trunk. One API key, one prepaid balance, every voice engine.

Works in Dart and in Flutter, including on the web.

- Every `/v1` endpoint as a typed method, checked against the API's OpenAPI document by a test.
- Cursor pagination as a `Stream`.
- Automatic idempotency keys on the two paths that spend money, so a retried timeout never dials twice.
- Retries on rate limits (honouring `Retry-After`) and on transient failures, only where a retry is safe.
- Errors that carry the API's stable `code`, the `requestId` to quote, and the `docUrl` to read.
- One dependency: `package:http`.

```bash
dart pub add wixzel_voice
```

Up to 0.3.0 this package was published as `wixzel_phone`. To move across, depend on `wixzel_voice` and import `package:wixzel_voice/wixzel_voice.dart`; `WixzelPhone` still works as a deprecated alias of `WixzelVoice`. See the [changelog](CHANGELOG.md).

## Quickstart

```dart
import 'package:wixzel_voice/wixzel_voice.dart';

final client = WixzelVoice(apiKey: 'wv_live_…');

// What can the platform serve right now, and at what price?
final engines = await client.engines.list();

final agent = await client.agents.create(CreateAgent(
  name: 'Support',
  systemPrompt: 'You are a concise support agent.',
  openingMessage: 'Hi, how can I help?',
  voice: VoiceConfig.composed(
    stt: const SttConfig(model: 'deepgram/nova-3'),
    llm: const LlmConfig(model: 'openrouter/gpt-4o-mini'),
    tts: const TtsConfig(model: 'elevenlabs/eleven_turbo_v2_5'),
  ),
));

// Spends credit and rings a real phone. An Idempotency-Key is generated for you.
final call = await client.calls.create(
  CreateCall(to: '+14155551234', agentId: agent.id),
);

final detail = await client.calls.retrieve(call.id);
print('${detail.status.value} ${detail.costMicros} ${detail.transcript.length} turns');

client.close();
```

Or hand the whole turn to one model:

```dart
voice: VoiceConfig.realtimeModel(
  const RealtimeConfig(model: 'google/gemini-live-2.5-flash', voice: 'Charon'),
),
```

## Pagination

Every list returns a `Page`. Stream it to walk every page; the cursor and your query are carried along.

```dart
final calls = await client.calls.list(status: CallStatus.completed, limit: 100);
await for (final call in calls.autoPaging()) {
  print('${call.id} ${call.durationSeconds}s');
}

// Or page by page
var page = await client.leads.list(tag: 'clinic');
while (page != null) {
  print('${page.data.length} leads, more: ${page.hasMore}');
  page = await page.nextPage();
}
```

## Errors

Match on `code`; the message may be reworded.

```dart
try {
  await client.calls.create(CreateCall(to: to, agentId: agentId));
} on WixzelException catch (e) {
  if (e.code == 'insufficient_credits') print('balance: ${e.balance}');
  print('${e.statusCode} ${e.code} ${e.requestId} ${e.docUrl}');
} on WixzelConnectionException catch (e) {
  // Never got an answer, even after retries. Retrying a keyed request is safe.
  print(e.message);
}
```

Response enums carry an `unknown` fallback, so a value the API adds tomorrow will not throw in an app shipped today.

## Idempotency

`calls.create` and `billing.createTopup` require an `Idempotency-Key`; the SDK generates one per call and reuses it across its own retries. Pass your own to make a retry from your side safe too, and use the `…WithResponse` variants to see whether the server replayed an earlier request:

```dart
final result = await client.calls.createWithResponse(
  CreateCall(to: to, agentId: agentId),
  idempotencyKey: 'order-$orderId',
);
if (result.idempotentReplay) print('the server had already placed this call');
print(result.data.id);
```

## Retries

- `429`: retried after `Retry-After` (capped at 10 seconds), up to `maxRetries` (default 2). Rate-limited requests are never charged.
- Network failures, timeouts and `502`–`504`: retried only for `GET` and for requests carrying an idempotency key. `DELETE`, `PATCH` and unkeyed `POST` (hang up, start, pause, test, rotate) are never repeated on an ambiguous failure.
- `500` and other `4xx`: never retried.

## Pinning a version

```dart
final client = WixzelVoice(apiKey: apiKey, apiVersion: '2026-09-01');
```

Sends `Wixzel-Version` so an upgrade is something you do rather than something that happens to you.

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | required | `wv_live_…` or `wv_test_…` |
| `baseUrl` | `https://api.voice.wixzel.com` | For a self-hosted API |
| `apiVersion` | none | `Wixzel-Version` date pin |
| `timeout` | 30 s | Per attempt |
| `maxRetries` | 2 | Retries after the first attempt |
| `httpClient` | one of its own | Pass your own; then closing it is your job |
| `defaultHeaders` | none | Sent on every request |

`client.request(method, path, …)` reaches any endpoint the SDK does not model yet, with the same auth, retry and error handling. `client.close()` releases the HTTP client when the SDK created it.

## Flutter

The package is pure Dart with no `dart:io` in its public path, so it runs on every Flutter target including the web. Keep live keys out of a shipped app: on mobile and web, call your own backend, and let it hold the key.

## Related

- [Documentation](https://docs.voice.wixzel.com/sdks) · [API reference](https://docs.voice.wixzel.com/api-reference)
- [Source](https://github.com/aqeelshamz/wixzel-voice-sdks), where issues and pull requests are read. The SDK is developed in the private monorepo that also holds the API, so a change to an endpoint and the change to its client land together, and is mirrored here on release.
- [`wixzel-voice`](https://www.npmjs.com/package/wixzel-voice), the same SDK for TypeScript and JavaScript
- [`wixzel-voice-mcp`](https://www.npmjs.com/package/wixzel-voice-mcp), the MCP server for Claude Code and claude.ai

MIT.
