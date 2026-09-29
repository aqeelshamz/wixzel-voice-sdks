import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import 'exception.dart';
import 'json.dart';
import 'page.dart';
import 'response.dart';
import 'uuid.dart';
import 'version.dart';

/// The default API host.
const String defaultBaseUrl = 'https://api.voice.wixzel.com';

const int _maxIdempotencyKeyLength = 255;
const Duration _retryAfterCap = Duration(seconds: 10);

/// Which key an account is using.
enum KeyMode {
  /// A `wv_live_…` key: real calls, real money.
  live,

  /// A `wv_test_…` key.
  test,

  /// Neither prefix; probably not a Wixzel key.
  unknown,
}

/// The transport every resource method goes through.
///
/// It knows the API's conventions so the resources do not have to: the bearer
/// header, the optional version pin, cursor pagination, an idempotency key on
/// the paths that spend money, `Retry-After` on a 429, and the error envelope.
class Transport {
  /// Builds a transport. [httpClient] is injectable so tests can use
  /// `MockClient` and apps can supply a configured client.
  Transport({
    required String apiKey,
    String baseUrl = defaultBaseUrl,
    String? apiVersion,
    Duration timeout = const Duration(seconds: 30),
    int maxRetries = 2,
    http.Client? httpClient,
    Map<String, String> defaultHeaders = const {},
    Future<void> Function(Duration)? sleep,
    Random? random,
  })  : _apiKey = apiKey,
        _baseUrl = baseUrl.replaceAll(RegExp(r'/+$'), ''),
        _apiVersion = apiVersion,
        _timeout = timeout,
        _maxRetries = maxRetries,
        _ownsClient = httpClient == null,
        _client = httpClient ?? http.Client(),
        _defaultHeaders = defaultHeaders,
        _sleep = sleep ?? Future<void>.delayed,
        _random = random ?? Random() {
    if (apiKey.isEmpty) {
      throw ArgumentError.value(
          apiKey, 'apiKey', 'wixzel_voice: an API key is required');
    }
  }

  final String _apiKey;
  final String _baseUrl;
  final String? _apiVersion;
  final Duration _timeout;
  final int _maxRetries;
  final http.Client _client;
  final bool _ownsClient;
  final Map<String, String> _defaultHeaders;
  final Future<void> Function(Duration) _sleep;
  final Random _random;

  /// The base URL requests go to.
  String get baseUrl => _baseUrl;

  /// Whether the key is live, test, or neither.
  KeyMode get keyMode {
    if (_apiKey.startsWith('wv_live_')) return KeyMode.live;
    if (_apiKey.startsWith('wv_test_')) return KeyMode.test;
    return KeyMode.unknown;
  }

  /// Closes the underlying client, if this transport created it.
  void close() {
    if (_ownsClient) _client.close();
  }

  /// Sends a request and returns the decoded body with its metadata.
  ///
  /// [idempotent] marks a money path: a key is generated unless
  /// [idempotencyKey] is given, and the same key is reused across retries.
  Future<WixzelResponse<Object?>> send(
    String method,
    String path, {
    Map<String, Object?>? query,
    Object? body,
    bool idempotent = false,
    String? idempotencyKey,
    Map<String, String>? headers,
    int? maxRetries,
  }) async {
    final uri = Uri.parse('$_baseUrl$path').replace(
      queryParameters: _encodeQuery(query),
    );

    final requestHeaders = <String, String>{
      'Authorization': 'Bearer $_apiKey',
      'Accept': 'application/json',
      'User-Agent': userAgent,
      'X-Wixzel-Client': clientHeader,
      ..._defaultHeaders,
      ...?headers,
    };
    if (_apiVersion != null) requestHeaders['Wixzel-Version'] = _apiVersion;
    if (body != null) requestHeaders['Content-Type'] = 'application/json';

    // Decided once, before the loop: every retry of this call reuses it,
    // which is the whole point of the key.
    final key = idempotencyKey ?? (idempotent ? uuidV4(_random) : null);
    if (key != null) {
      if (key.isEmpty || key.length > _maxIdempotencyKeyLength) {
        throw ArgumentError.value(
          key,
          'idempotencyKey',
          'wixzel_voice: must be 1–$_maxIdempotencyKeyLength characters',
        );
      }
      requestHeaders['Idempotency-Key'] = key;
    }

    // Safe to repeat: a read, or anything the server can dedupe by key.
    final repeatable = method == 'GET' || key != null;
    final budget = maxRetries ?? _maxRetries;
    final encoded = body == null ? null : jsonEncode(body);

    for (var attempt = 0;; attempt++) {
      http.Response response;
      try {
        final request = http.Request(method, uri)
          ..headers.addAll(requestHeaders);
        if (encoded != null) request.body = encoded;
        final streamed = await _client.send(request).timeout(_timeout);
        response = await http.Response.fromStream(streamed);
      } on Object catch (error) {
        if (repeatable && attempt < budget) {
          await _sleep(_backoff(attempt));
          continue;
        }
        throw WixzelConnectionException(
          'wixzel_voice: $method $path failed after ${attempt + 1} attempt(s): $error',
          error,
        );
      }

      final status = response.statusCode;
      final headersLower = response.headers;

      if (status == 429 && attempt < budget) {
        await _sleep(_retryAfter(headersLower) ?? _backoff(attempt));
        continue;
      }
      if (_isTransient(status) && repeatable && attempt < budget) {
        await _sleep(_retryAfter(headersLower) ?? _backoff(attempt));
        continue;
      }

      final meta = (
        requestId: headersLower['x-request-id'],
        replay: headersLower['idempotent-replay'] == 'true',
      );

      if (status == 204 || response.body.isEmpty) {
        return WixzelResponse<Object?>(
          data: null,
          statusCode: status,
          headers: headersLower,
          requestId: meta.requestId,
          idempotentReplay: meta.replay,
        );
      }

      Object? parsed;
      try {
        parsed = jsonDecode(response.body);
      } on FormatException {
        parsed = null;
      }

      if (status >= 400) {
        throw WixzelException.fromResponse(
          statusCode: status,
          body: parsed is Json ? parsed : null,
          headers: headersLower,
          rawBody: response.body,
        );
      }

      return WixzelResponse<Object?>(
        data: parsed,
        statusCode: status,
        headers: headersLower,
        requestId: meta.requestId,
        idempotentReplay: meta.replay,
      );
    }
  }

  /// Sends a request and maps the JSON object it returns.
  Future<T> request<T>(
    String method,
    String path,
    T Function(Json) fromJson, {
    Map<String, Object?>? query,
    Object? body,
    bool idempotent = false,
    String? idempotencyKey,
    Map<String, String>? headers,
    int? maxRetries,
  }) async {
    final response = await requestWithResponse<T>(
      method,
      path,
      fromJson,
      query: query,
      body: body,
      idempotent: idempotent,
      idempotencyKey: idempotencyKey,
      headers: headers,
      maxRetries: maxRetries,
    );
    return response.data;
  }

  /// As [request], but keeps the status, request id and replay flag.
  Future<WixzelResponse<T>> requestWithResponse<T>(
    String method,
    String path,
    T Function(Json) fromJson, {
    Map<String, Object?>? query,
    Object? body,
    bool idempotent = false,
    String? idempotencyKey,
    Map<String, String>? headers,
    int? maxRetries,
  }) async {
    final raw = await send(
      method,
      path,
      query: query,
      body: body,
      idempotent: idempotent,
      idempotencyKey: idempotencyKey,
      headers: headers,
      maxRetries: maxRetries,
    );
    final data = raw.data;
    if (data is! Json) {
      throw WixzelException(
        statusCode: raw.statusCode,
        code: 'invalid_response',
        message: 'wixzel_voice: expected a JSON object from $method $path',
        headers: raw.headers,
        requestId: raw.requestId,
      );
    }
    return WixzelResponse<T>(
      data: fromJson(data),
      statusCode: raw.statusCode,
      headers: raw.headers,
      requestId: raw.requestId,
      idempotentReplay: raw.idempotentReplay,
    );
  }

  /// Sends a request that returns no body.
  Future<void> requestVoid(
    String method,
    String path, {
    Map<String, Object?>? query,
    Object? body,
    Map<String, String>? headers,
    int? maxRetries,
  }) async {
    await send(method, path,
        query: query, body: body, headers: headers, maxRetries: maxRetries);
  }

  /// Fetches a cursor-paginated list. The query is carried to later pages.
  Future<Page<T>> list<T>(
    String path,
    T Function(Json) fromJson, {
    Map<String, Object?>? query,
    Map<String, String>? headers,
    int? maxRetries,
  }) {
    Future<Page<T>> fetch(String? cursor) async {
      final effective = <String, Object?>{...?query};
      if (cursor != null) {
        effective.remove('ending_before');
        effective['starting_after'] = cursor;
      }
      final body = await send(
        'GET',
        path,
        query: effective,
        headers: headers,
        maxRetries: maxRetries,
      );
      final data = body.data;
      if (data is! Json) {
        throw WixzelException(
          statusCode: body.statusCode,
          code: 'invalid_response',
          message: 'wixzel_voice: expected a list envelope from GET $path',
          headers: body.headers,
          requestId: body.requestId,
        );
      }
      return Page<T>.fromJson(data, fromJson, (next) => fetch(next));
    }

    return fetch(null);
  }

  Map<String, String>? _encodeQuery(Map<String, Object?>? query) {
    if (query == null || query.isEmpty) return null;
    final out = <String, String>{};
    query.forEach((key, value) {
      if (value == null) return;
      if (value is String && value.isEmpty) return;
      out[key] = value is DateTime ? isoUtc(value) : '$value';
    });
    return out.isEmpty ? null : out;
  }

  bool _isTransient(int status) =>
      status == 502 || status == 503 || status == 504;

  Duration? _retryAfter(Map<String, String> headers) {
    final raw = headers['retry-after'];
    if (raw == null) return null;
    final seconds = int.tryParse(raw);
    if (seconds == null || seconds < 0) return null;
    final wait = Duration(seconds: seconds);
    return wait > _retryAfterCap ? _retryAfterCap : wait;
  }

  /// 500 ms, 1 s, 2 s, … capped at 8 s, with ±25 % jitter so a fleet does
  /// not retry in lockstep.
  Duration _backoff(int attempt) {
    final base = min(500 * (1 << attempt), 8000);
    final jittered = base * (0.75 + _random.nextDouble() * 0.5);
    return Duration(milliseconds: jittered.round());
  }
}
