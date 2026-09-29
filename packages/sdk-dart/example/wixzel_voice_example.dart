// Build an agent and place a test call.
//
//   dart run example/wixzel_voice_example.dart
//
// Needs WIXZEL_API_KEY in the environment. The call spends credit and rings
// a real phone, so it only runs when you also set CALL_TO.
import 'dart:io';

import 'package:wixzel_voice/wixzel_voice.dart';

Future<void> main() async {
  final apiKey = Platform.environment['WIXZEL_API_KEY'];
  if (apiKey == null) {
    stderr.writeln(
        'Set WIXZEL_API_KEY. Create one at https://voice.wixzel.com/keys');
    exit(1);
  }

  final client = WixzelVoice(apiKey: apiKey);

  try {
    // What can the platform serve right now, and at what price?
    final engines = await client.engines.list();
    for (final engine in engines.data.where((e) => e.available)) {
      stdout.writeln(
          '${engine.id} (${engine.kind.value}): ${engine.models.length} models');
    }

    final balance = await client.billing.balance();
    stdout.writeln('Balance: ${balance.balanceDisplay}');

    final agent = await client.agents.create(CreateAgent(
      name: 'Support',
      systemPrompt:
          'You are a concise support agent. Keep answers to one or two sentences.',
      openingMessage: 'Hi, how can I help?',
      voice: VoiceConfig.composed(
        stt: const SttConfig(model: 'deepgram/nova-3'),
        llm: const LlmConfig(model: 'openrouter/gpt-4o-mini'),
        tts: const TtsConfig(model: 'elevenlabs/eleven_turbo_v2_5'),
      ),
    ));
    stdout.writeln('Created agent ${agent.id}');

    // Every call this month, page after page.
    final calls =
        await client.calls.list(limit: 100, status: CallStatus.completed);
    var total = 0;
    await for (final call in calls.autoPaging()) {
      total += call.costMicros ?? 0;
    }
    stdout.writeln(
        'Completed calls so far: \$${(total / 1000000).toStringAsFixed(2)}');

    final to = Platform.environment['CALL_TO'];
    if (to == null) {
      stdout.writeln(
          'Set CALL_TO to place a test call. It spends credit and rings a real phone.');
      return;
    }

    final call =
        await client.calls.create(CreateCall(to: to, agentId: agent.id));
    stdout.writeln('Placed ${call.id}, status ${call.status.value}');

    final detail = await client.calls.retrieve(call.id);
    if (detail.failureCode != null) {
      stdout.writeln(
          'Did not connect (${detail.failureCode}): ${detail.failureReason}');
    }
  } on WixzelException catch (e) {
    stderr.writeln('${e.code}: ${e.message}');
    if (e.requestId != null) stderr.writeln('request_id: ${e.requestId}');
    if (e.docUrl != null) stderr.writeln(e.docUrl);
    exitCode = 1;
  } on WixzelConnectionException catch (e) {
    stderr.writeln(e.message);
    exitCode = 1;
  } finally {
    client.close();
  }
}
