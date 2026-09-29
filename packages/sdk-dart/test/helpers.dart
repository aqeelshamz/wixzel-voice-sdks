import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:wixzel_voice/wixzel_voice.dart';

/// One request the fake API received.
class Recorded {
  Recorded(this.method, this.url, this.headers, this.body);

  final String method;
  final Uri url;
  final Map<String, String> headers;
  final Map<String, dynamic>? body;

  String get path => url.path;
  Map<String, String> get query => url.queryParameters;
}

/// A scripted answer.
class Scripted {
  Scripted(
      {this.status = 200, this.body, this.headers = const {}, this.throws});

  final int status;
  final Object? body;
  final Map<String, String> headers;
  final Object? throws;
}

/// A fake API: records every request, answers from a queue, and echoes when
/// the queue is empty so a test only scripts what it cares about.
class FakeApi {
  final List<Recorded> requests = [];
  final List<Scripted> queue = [];
  final List<Duration> sleeps = [];

  Recorded get last => requests.last;

  void reset() {
    requests.clear();
    queue.clear();
    sleeps.clear();
  }

  Future<void> sleep(Duration d) async => sleeps.add(d);

  http.Client get client => MockClient((request) async {
        requests.add(Recorded(
          request.method,
          request.url,
          request.headers.map((k, v) => MapEntry(k.toLowerCase(), v)),
          request.body.isEmpty
              ? null
              : jsonDecode(request.body) as Map<String, dynamic>,
        ));
        final next = queue.isEmpty
            ? Scripted(body: {'echoed': true, 'path': request.url.path})
            : queue.removeAt(0);
        final thrown = next.throws;
        if (thrown != null) {
          throw thrown;
        }
        if (next.status == 204) {
          return http.Response('', 204, headers: next.headers);
        }
        final body = next.body is String
            ? next.body! as String
            : jsonEncode(next.body ?? {});
        return http.Response(body, next.status, headers: {
          'content-type':
              next.body is String ? 'text/plain' : 'application/json',
          ...next.headers,
        });
      });

  /// A client wired to this fake, with retries that do not really wait.
  WixzelVoice wixzel({
    String apiKey = 'wv_test_abc',
    String baseUrl = 'https://api.example',
    String? apiVersion,
    int maxRetries = 2,
    Map<String, String> defaultHeaders = const {},
  }) =>
      WixzelVoice(
        apiKey: apiKey,
        baseUrl: baseUrl,
        apiVersion: apiVersion,
        maxRetries: maxRetries,
        httpClient: client,
        defaultHeaders: defaultHeaders,
        sleep: sleep,
      );
}

/// The API's error envelope.
Scripted apiError(
  int status,
  String type,
  String code, {
  String message = 'nope',
  Map<String, String> headers = const {},
  Map<String, dynamic> extra = const {},
}) =>
    Scripted(
      status: status,
      body: {
        'error': {
          'type': type,
          'code': code,
          'message': message,
          'request_id': 'req_test',
          ...extra,
        }
      },
      headers: headers,
    );

/// One page of a cursor-paginated list.
Scripted listPage(List<String> ids, String? next, {String object = 'call'}) =>
    Scripted(body: {
      'object': 'list',
      'data': [
        for (final id in ids)
          {
            'id': id,
            'object': object,
            'session_id': 'sess_$id',
            'status': 'completed',
            'direction': 'outbound',
            'name': id,
            'phone_number': '+10000000000',
            'tags': <String>[],
            'created_at': '2026-09-01T12:00:00.000Z',
          }
      ],
      'has_more': next != null,
      'next_cursor': next,
    });
