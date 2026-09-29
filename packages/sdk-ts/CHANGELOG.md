# Changelog

## 0.4.0 (2026-09-29)

Renamed from `wixzel-phone` to `wixzel-voice`, because the product is called
Wixzel Voice again. The API surface is unchanged.

- Install `wixzel-voice`, and import from `wixzel-voice` and
  `wixzel-voice/realtime`.
- The client class is `WixzelVoice`, with `WixzelVoiceOptions`. The old names,
  `WixzelPhone` and `WixzelPhoneOptions`, are kept as deprecated aliases of the
  same class and type, so existing code only has to change its import.
- The default base URL is now `https://api.voice.wixzel.com`.
  `https://api.phone.wixzel.com` keeps serving, so `wixzel-phone` 0.3.0 and
  earlier keep working without a change.
- Requests send `User-Agent: wixzel-voice/0.4.0` and
  `X-Wixzel-Client: wixzel-voice-ts/0.4.0`, and error messages the SDK raises
  itself begin `wixzel-voice:`.

## 0.3.0

Realtime: talk to an agent from a browser or an app, with no SIP trunk.

- `client.realtime.createSession()` — server-side. Mints a one-minute,
  single-use `client_secret` for `wss /v1/realtime`. Nothing is charged until
  a client connects; the session then bills, counts toward concurrency and is
  logged exactly like a call.
- `wixzel-phone/realtime` — a new, browser-only entry point. `RealtimeSession`
  handles the microphone (an inlined µ-law AudioWorklet, so there is no file
  to host), playback, barge-in, mute and transcripts. `requestMicrophone()`
  lets a page ask for the mic before it mints a session.
- `Call` gains `channel` (`phone` or `web`), and `calls.list()` takes
  `channel` as a filter.

## 0.2.0

Eight operations the published 0.1.0 did not have, which is the whole reason
for a minor rather than a patch: 0.1.0 claimed to cover every `/v1` operation
and, as the API grew, stopped doing so.

- `client.webhooks` — `retrieve`, `update`, `rotateSecret`, `test` and
  `deliveries`. A singleton, so there is no `list`; `deliveries()` pages
  through delivery attempts, one record per POST we made.
- `client.engines.languages()` and `client.engines.voices()`.
- `client.agents.testCall()`.

## 0.1.0

First release. Every `/v1` operation as a typed method, cursor pagination with `for await`, automatic idempotency keys on the money paths, retries on rate limits and transient failures, and structured errors with the API's `code`, `request_id` and `doc_url`.
