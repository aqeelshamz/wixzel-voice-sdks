import 'package:test/test.dart';
import 'package:wixzel_voice/wixzel_voice.dart';

import 'helpers.dart';

void main() {
  final api = FakeApi();
  setUp(api.reset);

  group('client basics', () {
    test(
        'sends auth, accept, user agent and client headers; no content type on GET',
        () async {
      final client = api.wixzel();
      api.queue.add(Scripted(body: {'id': 'ag1', 'name': 'Support'}));
      await client.agents.retrieve('ag1');

      final req = api.last;
      expect(req.method, 'GET');
      expect(req.url.toString(), 'https://api.example/v1/agents/ag1');
      expect(req.headers['authorization'], 'Bearer wv_test_abc');
      expect(req.headers['accept'], 'application/json');
      expect(req.headers['user-agent'], startsWith('wixzel-voice/'));
      expect(req.headers['x-wixzel-client'], startsWith('wixzel-voice-dart/'));
      expect(req.headers.containsKey('wixzel-version'), isFalse);
      expect(client.keyMode, KeyMode.test);
      expect(client.baseUrl, 'https://api.example');
    });

    test('pins the API version and merges default headers', () async {
      final client = api
          .wixzel(apiVersion: '2026-09-01', defaultHeaders: {'X-Team': 'ops'});
      await client.engines.list();
      expect(api.last.headers['wixzel-version'], '2026-09-01');
      expect(api.last.headers['x-team'], 'ops');
    });

    test('encodes bodies as JSON and ids in paths', () async {
      final client = api.wixzel();
      await client.agents.update('a b/c', const UpdateAgent(name: 'Renamed'));
      final req = api.last;
      expect(req.method, 'PATCH');
      // Uri.path decodes; the wire form is what matters.
      expect(req.url.toString(), 'https://api.example/v1/agents/a%20b%2Fc');
      expect(req.headers['content-type'], startsWith('application/json'));
      expect(req.body, {'name': 'Renamed'});
    });

    test('drops null and empty query values and formats dates', () async {
      final client = api.wixzel();
      api.queue.add(listPage([], null));
      await client.calls.list(
        limit: 5,
        failedOnly: true,
        status: CallStatus.completed,
        startedAfter: DateTime.utc(2026, 9, 1),
        agentId: null,
        phoneNumber: '',
      );
      expect(api.last.query, {
        'limit': '5',
        'failed_only': 'true',
        'status': 'completed',
        'started_after': '2026-09-01T00:00:00.000Z',
      });
    });

    test('a 204 completes without a body', () async {
      final client = api.wixzel();
      api.queue.add(Scripted(status: 204));
      await client.leads.delete('ld1');
      expect(api.last.method, 'DELETE');
    });

    test('an empty API key is refused', () {
      expect(() => WixzelVoice(apiKey: ''), throwsA(isA<ArgumentError>()));
    });

    test('defaults to the api.voice host', () {
      expect(defaultBaseUrl, 'https://api.voice.wixzel.com');
      final client = WixzelVoice(apiKey: 'wv_test_abc');
      expect(client.baseUrl, defaultBaseUrl);
      client.close();
    });

    test('the pre-rename class name still works, as the same class', () {
      // Code written against wixzel_phone 0.3.0 only has to change its import.
      // ignore: deprecated_member_use_from_same_package
      final client = WixzelPhone(apiKey: 'wv_test_abc');
      expect(client, isA<WixzelVoice>());
      client.close();
    });

    test('the escape hatch reaches any path with the same conventions',
        () async {
      final client = api.wixzel();
      await client.request('POST', '/v1/future',
          body: {'a': 1}, idempotent: true);
      expect(api.last.path, '/v1/future');
      expect(api.last.headers['idempotency-key'], matches(r'^[0-9a-f-]{36}$'));
    });
  });

  group('errors', () {
    test('parses the envelope, doc_url, param, request id and balance header',
        () async {
      final client = api.wixzel();
      api.queue.add(apiError(
        402,
        'insufficient_credits',
        'insufficient_credits',
        message: 'Balance too low.',
        headers: {'x-wixzel-balance': r'$0.12'},
        extra: {
          'doc_url':
              'https://docs.voice.wixzel.com/errors#insufficient_credits',
          'param': 'to'
        },
      ));

      await expectLater(
        client.calls
            .create(const CreateCall(to: '+14155551234', agentId: 'ag1')),
        throwsA(
          isA<WixzelException>()
              .having((e) => e.statusCode, 'statusCode', 402)
              .having(
                  (e) => e.type, 'type', WixzelErrorType.insufficientCredits)
              .having((e) => e.code, 'code', 'insufficient_credits')
              .having((e) => e.message, 'message', 'Balance too low.')
              .having((e) => e.param, 'param', 'to')
              .having((e) => e.requestId, 'requestId', 'req_test')
              .having(
                  (e) => e.docUrl, 'docUrl', contains('#insufficient_credits'))
              .having((e) => e.balance, 'balance', r'$0.12'),
        ),
      );
    });

    test('an unknown error type falls back without throwing', () async {
      final client = api.wixzel(maxRetries: 0);
      api.queue.add(apiError(418, 'teapot_error', 'i_am_a_teapot'));
      await expectLater(
        client.engines.list(),
        throwsA(isA<WixzelException>()
            .having((e) => e.type, 'type', WixzelErrorType.unknown)
            .having((e) => e.rawType, 'rawType', 'teapot_error')),
      );
    });

    test('a non-JSON failure still becomes a WixzelException', () async {
      final client = api.wixzel(maxRetries: 0);
      api.queue.add(Scripted(status: 502, body: '<html>bad gateway</html>'));
      await expectLater(
        client.engines.list(),
        throwsA(isA<WixzelException>()
            .having((e) => e.code, 'code', 'http_502')
            .having((e) => e.message, 'message', contains('bad gateway'))),
      );
    });

    test('a 4xx is never retried', () async {
      final client = api.wixzel();
      api.queue.add(apiError(404, 'not_found_error', 'agent_not_found'));
      await expectLater(
          client.agents.retrieve('zzz'), throwsA(isA<WixzelException>()));
      expect(api.requests, hasLength(1));
    });
  });
}
