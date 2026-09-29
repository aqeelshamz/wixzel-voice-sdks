## 0.4.0 (2026-09-29)

Renamed from `wixzel_phone` to `wixzel_voice`, because the product is called
Wixzel Voice again. The API surface is unchanged.

- Depend on `wixzel_voice` and import
  `package:wixzel_voice/wixzel_voice.dart`.
- The client class is `WixzelVoice`. The old name, `WixzelPhone`, is kept as a
  deprecated typedef of the same class, so existing code only has to change
  its import.
- The default base URL (`defaultBaseUrl`) is now
  `https://api.voice.wixzel.com`. `https://api.phone.wixzel.com` keeps serving,
  so `wixzel_phone` 0.3.0 and earlier keep working without a change.
- Requests send `User-Agent: wixzel-voice/0.4.0` and
  `X-Wixzel-Client: wixzel-voice-dart/0.4.0`, and error messages the SDK raises
  itself begin `wixzel_voice:`.

## 0.3.0

Realtime: talk to an agent from a Flutter or Dart app, with no SIP trunk.

- `client.realtime.createSession()` with `CreateRealtimeSession` and
  `RealtimeSession` — server-side. Mints a one-minute, single-use client
  secret for `wss /v1/realtime`.
- `RealtimeConnection` — the protocol client, over `web_socket_channel`:
  `sendAudio`, a typed `events` stream (`RealtimeStarted`, `RealtimeAudio`,
  `RealtimeAudioClear`, `RealtimeTranscript`, `RealtimeWarning`,
  `RealtimeError`, `RealtimeEnded`), `end()` and the close code. Microphone and
  speaker stay with the app; `pcm16ToMulaw` and `mulawToPcm16` convert.
- `Call.channel` (`phone` or `web`).
- New dependency: `web_socket_channel`.

## 0.2.0

Eight operations the published 0.1.0 did not have, which is the whole reason
for a minor rather than a patch: 0.1.0 claimed to cover every `/v1` operation
and, as the API grew, stopped doing so.

- `client.webhooks` — `retrieve`, `update`, `rotateSecret`, `test` and
  `deliveries`, with `WebhookEvent`, `Webhook`, `UpdateWebhook`,
  `WebhookSecret` and `WebhookDelivery`. A singleton, so there is no `list`.
- `client.engines.languages()` and `client.engines.voices()`.
- `client.agents.testCall()`.

## 0.1.0

First release. Every `/v1` operation as a typed method, cursor pagination with `autoPaging()`, automatic idempotency keys on the money paths, retries on rate limits and transient failures, and a `WixzelException` carrying the API's `code`, `requestId` and `docUrl`.
