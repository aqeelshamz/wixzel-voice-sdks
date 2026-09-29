import 'package:test/test.dart';
import 'package:wixzel_voice/wixzel_voice.dart';

import 'helpers.dart';

void main() {
  final api = FakeApi();
  setUp(api.reset);

  group('idempotency', () {
    test('the money paths send a generated key; other creates do not',
        () async {
      final client = api.wixzel();

      await client.calls
          .create(const CreateCall(to: '+14155551234', agentId: 'ag1'));
      expect(api.last.headers['idempotency-key'], matches(r'^[0-9a-f-]{36}$'));

      await client.billing.createTopup(const CreateTopup(amountUsd: 20));
      expect(api.last.headers['idempotency-key'], matches(r'^[0-9a-f-]{36}$'));

      await client.agents.create(CreateAgent(
        name: 'a',
        systemPrompt: 'b',
        openingMessage: 'c',
        voice: VoiceConfig.realtimeModel(
          const RealtimeConfig(model: 'google/gemini-live'),
        ),
      ));
      expect(api.last.headers.containsKey('idempotency-key'), isFalse);
    });

    test('an explicit key is sent verbatim and stays out of the body',
        () async {
      final client = api.wixzel();
      await client.calls.create(
        const CreateCall(to: '+14155551234', agentId: 'ag1'),
        idempotencyKey: 'order-42',
      );
      expect(api.last.headers['idempotency-key'], 'order-42');
      expect(api.last.body, {'to': '+14155551234', 'agent_id': 'ag1'});
    });

    test('a replay is visible through createWithResponse', () async {
      final client = api.wixzel();
      api.queue.add(Scripted(
        status: 201,
        body: {'id': 'c1', 'session_id': 's1'},
        headers: {'idempotent-replay': 'true', 'x-request-id': 'req_9'},
      ));
      final replayed = await client.calls.createWithResponse(
        const CreateCall(to: '+14155551234', agentId: 'ag1'),
        idempotencyKey: 'k',
      );
      expect(replayed.idempotentReplay, isTrue);
      expect(replayed.requestId, 'req_9');
      expect(replayed.data.id, 'c1');

      api.queue
          .add(Scripted(status: 201, body: {'id': 'c2', 'session_id': 's2'}));
      final fresh = await client.calls.createWithResponse(
        const CreateCall(to: '+14155551234', agentId: 'ag1'),
      );
      expect(fresh.idempotentReplay, isFalse);
    });

    test('a key over 255 characters is refused before any request', () async {
      final client = api.wixzel();
      expect(
        () => client.calls.create(
          const CreateCall(to: '+14155551234', agentId: 'ag1'),
          idempotencyKey: 'x' * 256,
        ),
        throwsA(isA<ArgumentError>()),
      );
      expect(api.requests, isEmpty);
    });
  });
}
