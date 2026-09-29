import 'package:http/http.dart' as http;
import 'package:test/test.dart';
import 'package:wixzel_voice/wixzel_voice.dart';

import 'helpers.dart';

Scripted limited({String? retryAfter}) => apiError(
      429,
      'rate_limit_error',
      'rate_limit_exceeded',
      message: 'Too many requests.',
      headers: retryAfter == null ? const {} : {'retry-after': retryAfter},
    );

void main() {
  final api = FakeApi();
  setUp(api.reset);

  group('retries', () {
    test('a 429 is retried after Retry-After, capped at ten seconds', () async {
      final client = api.wixzel();
      api.queue.addAll([
        limited(retryAfter: '2'),
        limited(retryAfter: '60'),
        Scripted(body: {'object': 'balance', 'balance_display': r'$5.00'}),
      ]);
      final balance = await client.billing.balance();
      expect(balance.balanceDisplay, r'$5.00');
      expect(api.requests, hasLength(3));
      expect(api.sleeps,
          [const Duration(seconds: 2), const Duration(seconds: 10)]);
    });

    test('without Retry-After the wait backs off with jitter', () async {
      final client = api.wixzel();
      api.queue.addAll([
        limited(),
        limited(),
        Scripted(body: {'object': 'balance'})
      ]);
      await client.billing.balance();
      expect(api.sleeps, hasLength(2));
      expect(api.sleeps[0].inMilliseconds, inInclusiveRange(375, 625));
      expect(api.sleeps[1].inMilliseconds, inInclusiveRange(750, 1250));
    });

    test('gives up after maxRetries and reports retryAfter', () async {
      final client = api.wixzel(maxRetries: 1);
      api.queue.addAll([limited(retryAfter: '3'), limited(retryAfter: '4')]);
      await expectLater(
        client.billing.balance(),
        throwsA(isA<WixzelException>()
            .having((e) => e.statusCode, 'statusCode', 429)
            .having(
                (e) => e.retryAfter, 'retryAfter', const Duration(seconds: 4))),
      );
      expect(api.requests, hasLength(2));
    });

    test('a 503 is retried on a GET but not on an unkeyed POST', () async {
      final client = api.wixzel();
      api.queue.addAll([
        apiError(503, 'api_error', 'engine_unavailable'),
        Scripted(body: {'object': 'list', 'data': <dynamic>[]}),
      ]);
      await client.engines.list();
      expect(api.requests, hasLength(2));

      api.reset();
      api.queue.add(apiError(503, 'api_error', 'engine_unavailable'));
      await expectLater(
          client.campaigns.start('cp1'), throwsA(isA<WixzelException>()));
      expect(api.requests, hasLength(1));
    });

    test('a 503 on a keyed POST is retried with the same key', () async {
      final client = api.wixzel();
      api.queue.addAll([
        apiError(503, 'api_error', 'engine_unavailable'),
        Scripted(status: 201, body: {'id': 'c1', 'session_id': 's1'}),
      ]);
      await client.calls
          .create(const CreateCall(to: '+14155551234', agentId: 'ag1'));
      expect(api.requests, hasLength(2));
      expect(api.requests[0].headers['idempotency-key'],
          api.requests[1].headers['idempotency-key']);
    });

    test('a 500 is never retried', () async {
      final client = api.wixzel();
      api.queue.add(apiError(500, 'api_error', 'internal_error'));
      await expectLater(client.engines.list(), throwsA(isA<WixzelException>()));
      expect(api.requests, hasLength(1));
    });

    test(
        'a network failure on a GET is retried, then becomes a connection error',
        () async {
      final client = api.wixzel();
      final failure = http.ClientException('connection closed');
      api.queue.addAll([
        Scripted(throws: failure),
        Scripted(throws: failure),
        Scripted(throws: failure),
      ]);
      await expectLater(
        client.engines.list(),
        throwsA(isA<WixzelConnectionException>()
            .having((e) => e.message, 'message', contains('after 3 attempt'))),
      );
      expect(api.requests, hasLength(3));
    });

    test('a network failure on an unkeyed POST surfaces at once', () async {
      final client = api.wixzel();
      api.queue
          .add(Scripted(throws: http.ClientException('connection closed')));
      await expectLater(
        client.campaigns.start('cp1'),
        throwsA(isA<WixzelConnectionException>()),
      );
      expect(api.requests, hasLength(1));
    });
  });
}
