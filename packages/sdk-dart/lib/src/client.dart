import 'dart:math';

import 'package:http/http.dart' as http;

import 'json.dart';
import 'resources/agents.dart';
import 'resources/api_keys.dart';
import 'resources/appointments.dart';
import 'resources/billing.dart';
import 'resources/calls.dart';
import 'resources/campaigns.dart';
import 'resources/engines.dart';
import 'resources/webhooks.dart';
import 'resources/realtime.dart';
import 'resources/knowledge_bases.dart';
import 'resources/leads.dart';
import 'resources/phone_numbers.dart';
import 'resources/sip_trunks.dart';
import 'resources/usage.dart';
import 'response.dart';
import 'transport.dart';

/// The Wixzel Voice API.
///
/// ```dart
/// final client = WixzelVoice(apiKey: Platform.environment['WIXZEL_API_KEY']!);
/// final call = await client.calls.create(
///   CreateCall(to: '+14155551234', agentId: agent.id),
/// );
/// client.close();
/// ```
class WixzelVoice {
  /// Builds a client.
  ///
  /// [httpClient] is injectable, so tests can pass `MockClient` and apps can
  /// pass a client they have configured. When you pass one, closing it stays
  /// your job; [close] only closes a client this constructor created.
  WixzelVoice({
    required String apiKey,
    String baseUrl = defaultBaseUrl,
    String? apiVersion,
    Duration timeout = const Duration(seconds: 30),
    int maxRetries = 2,
    http.Client? httpClient,
    Map<String, String> defaultHeaders = const {},
    Future<void> Function(Duration)? sleep,
    Random? random,
  }) : this.fromTransport(Transport(
          apiKey: apiKey,
          baseUrl: baseUrl,
          apiVersion: apiVersion,
          timeout: timeout,
          maxRetries: maxRetries,
          httpClient: httpClient,
          defaultHeaders: defaultHeaders,
          sleep: sleep,
          random: random,
        ));

  /// Builds a client around a transport you made yourself.
  WixzelVoice.fromTransport(this._transport)
      : agents = Agents(_transport),
        calls = Calls(_transport),
        leads = Leads(_transport),
        campaigns = Campaigns(_transport),
        knowledgeBases = KnowledgeBases(_transport),
        phoneNumbers = PhoneNumbers(_transport),
        sipTrunks = SipTrunks(_transport),
        appointments = Appointments(_transport),
        usage = Usage(_transport),
        billing = Billing(_transport),
        apiKeys = ApiKeys(_transport),
        engines = Engines(_transport),
        webhooks = Webhooks(_transport),
        realtime = Realtime(_transport);

  final Transport _transport;

  /// Voice agents.
  final Agents agents;

  /// Placing, watching and reading calls.
  final Calls calls;

  /// The contacts agents call.
  final Leads leads;

  /// One agent calling a list of leads.
  final Campaigns campaigns;

  /// Facts and FAQs an agent draws on.
  final KnowledgeBases knowledgeBases;

  /// Numbers you own at your carrier.
  final PhoneNumbers phoneNumbers;

  /// Your own carrier, connected.
  final SipTrunks sipTrunks;

  /// Bookings made by agents.
  final Appointments appointments;

  /// Every billable line, and the totals.
  final Usage usage;

  /// The prepaid balance, its history, and adding to it.
  final Billing billing;

  /// Scoped credentials.
  final ApiKeys apiKeys;

  /// What the platform can serve right now.
  final Engines engines;

  /// Where events are sent, and what happened when they got there.
  final Webhooks webhooks;

  /// The server-side half of realtime: minting sessions for your apps.
  final Realtime realtime;

  /// Whether the key is live, test, or neither.
  KeyMode get keyMode => _transport.keyMode;

  /// The base URL requests go to.
  String get baseUrl => _transport.baseUrl;

  /// Calls an endpoint the SDK does not model yet, with the same auth,
  /// retry and error handling. [path] starts with `/v1/`.
  Future<WixzelResponse<Object?>> request(
    String method,
    String path, {
    Map<String, Object?>? query,
    Object? body,
    bool idempotent = false,
    String? idempotencyKey,
    Map<String, String>? headers,
    int? maxRetries,
  }) =>
      _transport.send(
        method,
        path,
        query: query,
        body: body,
        idempotent: idempotent,
        idempotencyKey: idempotencyKey,
        headers: headers,
        maxRetries: maxRetries,
      );

  /// Closes the underlying HTTP client, if this client created it.
  ///
  /// A long-lived app can skip this; a script should call it so the process
  /// can exit.
  void close() => _transport.close();
}

/// The name this client had as `wixzel_phone` (0.3.0 and earlier), kept so
/// code moving across only has to change its import.
@Deprecated('Use WixzelVoice')
typedef WixzelPhone = WixzelVoice;

/// The JSON object shape the API sends and receives.
typedef WixzelJson = Json;
