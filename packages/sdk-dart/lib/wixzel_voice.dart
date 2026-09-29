/// The official Dart SDK for the [Wixzel Voice](https://voice.wixzel.com)
/// API: build AI agents that place and answer real phone calls over your own
/// SIP trunk.
///
/// ```dart
/// import 'package:wixzel_voice/wixzel_voice.dart';
///
/// final client = WixzelVoice(apiKey: 'wv_live_…');
/// final agent = await client.agents.create(CreateAgent(
///   name: 'Support',
///   systemPrompt: 'You are a concise support agent.',
///   openingMessage: 'Hi, how can I help?',
///   voice: VoiceConfig.composed(
///     stt: SttConfig(model: 'deepgram/nova-3'),
///     llm: LlmConfig(model: 'openrouter/gpt-4o-mini'),
///     tts: TtsConfig(model: 'elevenlabs/eleven_turbo_v2_5'),
///   ),
/// ));
/// await client.calls.create(CreateCall(to: '+14155551234', agentId: agent.id));
/// client.close();
/// ```
library;

export 'src/client.dart';
export 'src/exception.dart';
export 'src/models/agent.dart';
export 'src/models/api_key.dart';
export 'src/models/appointment.dart';
export 'src/models/billing.dart';
export 'src/models/call.dart';
export 'src/models/campaign.dart';
export 'src/models/engine.dart';
export 'src/models/knowledge_base.dart';
export 'src/models/lead.dart';
export 'src/models/telephony.dart';
export 'src/models/voice.dart';
export 'src/models/webhook.dart';
export 'src/models/realtime.dart';
export 'src/operations.dart';
export 'src/page.dart';
export 'src/resources/agents.dart';
export 'src/resources/api_keys.dart';
export 'src/resources/appointments.dart';
export 'src/resources/billing.dart';
export 'src/resources/calls.dart';
export 'src/resources/campaigns.dart';
export 'src/resources/engines.dart';
export 'src/resources/knowledge_bases.dart';
export 'src/resources/leads.dart';
export 'src/resources/phone_numbers.dart';
export 'src/resources/sip_trunks.dart';
export 'src/resources/usage.dart';
export 'src/resources/webhooks.dart';
export 'src/resources/realtime.dart';
export 'src/realtime_connection.dart';
export 'src/response.dart';
export 'src/transport.dart' show KeyMode, Transport, defaultBaseUrl;
export 'src/version.dart' show packageVersion;
