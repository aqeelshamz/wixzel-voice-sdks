import 'package:test/test.dart';
import 'package:wixzel_voice/wixzel_voice.dart';

/// Parsing is where an SDK quietly goes wrong, so every model is fed a
/// realistic payload and asked to give the values back.
void main() {
  group('models', () {
    test('an agent with a composed pipeline round-trips', () {
      final agent = Agent.fromJson({
        'id': 'ag1',
        'object': 'agent',
        'name': 'Support',
        'system_prompt': 'Be concise.',
        'opening_message': 'Hi, how can I help?',
        'voice': {
          'stt': {
            'model': 'deepgram/nova-3',
            'language': 'en-US',
            'endpointing_ms': 300
          },
          'llm': {
            'model': 'openrouter/gpt-4o-mini',
            'temperature': 0.7,
            'max_tokens': 200
          },
          'tts': {
            'model': 'elevenlabs/eleven_turbo_v2_5',
            'voice': '21m00Tcm4TlvDq8ikWAM'
          },
          'turn_taking': {
            'interrupt_sensitivity': 'high',
            'silence_wait_ms': 500
          },
        },
        'language': 'en-US',
        'knowledge_base_id': null,
        'outbound_phone_number_id': 'pn1',
        'appointment_booking_enabled': true,
        'created_at': '2026-09-01T12:00:00.000Z',
      });

      expect(agent.id, 'ag1');
      expect(agent.voice.stt?.model, 'deepgram/nova-3');
      expect(agent.voice.llm?.temperature, 0.7);
      expect(agent.voice.turnTaking?.interruptSensitivity,
          InterruptSensitivity.high);
      expect(agent.knowledgeBaseId, isNull);
      expect(agent.createdAt.isUtc, isTrue);
      expect(agent.voice.toJson()['stt'], {
        'model': 'deepgram/nova-3',
        'language': 'en-US',
        'endpointing_ms': 300,
      });
    });

    test('a realtime voice omits the pipeline stages', () {
      final voice = VoiceConfig.realtimeModel(
        const RealtimeConfig(
            model: 'google/gemini-live-2.5-flash', voice: 'Charon'),
      );
      expect(voice.toJson(), {
        'realtime': {
          'model': 'google/gemini-live-2.5-flash',
          'voice': 'Charon'
        },
      });
    });

    test('a call detail carries transcript, errors and transfers', () {
      final call = CallDetail.fromJson({
        'id': 'c1',
        'object': 'call',
        'session_id': 'sip-4f2a',
        'status': 'completed',
        'direction': 'outbound',
        'agent_id': 'ag1',
        'to': '+14155551234',
        'duration_seconds': 42,
        'cost_micros': 30000,
        'failure_code': null,
        'started_at': '2026-09-01T12:00:00.000Z',
        'ended_at': '2026-09-01T12:00:42.000Z',
        'errors': [
          {
            'service': 'deepgram',
            'code': 'timeout',
            'message': 'slow',
            'at': null
          }
        ],
        'transcript': [
          {
            'role': 'assistant',
            'content': 'Hi, how can I help?',
            'timestamp': '2026-09-01T12:00:01.000Z'
          },
          {'role': 'user', 'content': 'Book me in.'},
        ],
        'transfers': [
          {
            'destination_name': 'Front desk',
            'status': 'answered',
            'attempt': 1,
            'sip_cause': 200
          }
        ],
      });

      expect(call.status, CallStatus.completed);
      expect(call.direction, CallDirection.outbound);
      expect(call.durationSeconds, 42);
      expect(call.transcript.first.role, TranscriptRole.assistant);
      expect(call.transcript.last.timestamp, isNull);
      expect(call.errors.single.service, 'deepgram');
      expect(call.transfers.single.destinationName, 'Front desk');
    });

    test('a status a future server invents parses as unknown', () {
      final call = Call.fromJson(
          {'id': 'c1', 'status': 'transcribing', 'direction': 'sideways'});
      expect(call.status, CallStatus.unknown);
      expect(call.direction, CallDirection.unknown);
    });

    test('the money models keep micro-USD as integers', () {
      final balance = Balance.fromJson({
        'object': 'balance',
        'balance_micros': 5000000,
        'balance_display': r'$5.00',
        'held_micros': 250000,
        'available_micros': 4750000,
        'currency': 'USD',
        'low_balance_threshold_micros': 1000000,
      });
      expect(balance.balanceMicros, 5000000);
      expect(balance.availableMicros, 4750000);

      final entry = LedgerEntry.fromJson({
        'object': 'ledger_entry',
        'kind': 'usage',
        'amount_micros': -33600,
        'balance_after_micros': 4966400,
        'ref_type': 'call',
        'ref_id': 'c1',
        'created_at': '2026-09-01T12:00:00.000Z',
      });
      expect(entry.kind, LedgerKind.usage);
      expect(entry.amountMicros, -33600);
    });

    test('a usage event keeps fractional rates and quantities', () {
      final event = UsageEvent.fromJson({
        'object': 'usage_event',
        'session_id': 'sip-4f2a',
        'component': 'stt',
        'provider': 'deepgram',
        'model': 'nova-3',
        'unit': 'second',
        'quantity': 187.5,
        'unit_price_micros': 0.179,
        'price_micros': 33600,
        'occurred_at': '2026-09-01T12:00:00.000Z',
      });
      expect(event.component, UsageComponent.stt);
      expect(event.quantity, 187.5);
      expect(event.unitPriceMicros, closeTo(0.179, 1e-9));
    });

    test('a created key carries its secret; scopes map to the enum', () {
      final key = CreatedApiKey.fromJson({
        'id': 'k1',
        'object': 'api_key',
        'name': 'production backend',
        'prefix': 'wv_live_',
        'last4': 'ab12',
        'scopes': ['agents:read', 'calls:write', 'not_a_scope'],
        'spend_limit_micros': null,
        'last_used_at': null,
        'expires_at': null,
        'created_at': '2026-09-01T12:00:00.000Z',
        'key': 'wv_live_secret_ab12',
      });
      expect(key.key, 'wv_live_secret_ab12');
      expect(key.scopes,
          [ApiScope.agentsRead, ApiScope.callsWrite, ApiScope.unknown]);
      expect(key.lastUsedAt, isNull);
    });

    test('a SIP trunk status keeps both halves of the diagnosis', () {
      final status = SipTrunkStatus.fromJson({
        'object': 'sip_trunk_status',
        'sip_trunk_id': 'st1',
        'origination_uri': 'sip:95.216.218.102:5090',
        'asterisk': {
          'connected': true,
          'endpoint_known': true,
          'endpoint_state': 'Reachable',
          'reachable': true,
          'round_trip_ms': 41.2,
          'detail': 'Asterisk says the endpoint is reachable.',
        },
        'probe': {
          'reachable': false,
          'method': 'OPTIONS',
          'detail': 'No answer.'
        },
        'recent_failures': [
          {
            'call_id': 'c9',
            'failure_code': 21,
            'failure_reason': 'Rejected.',
            'at': null
          }
        ],
      });
      expect(status.asterisk.reachable, isTrue);
      expect(status.probe.reachable, isFalse);
      expect(status.recentFailures.single.failureCode, 21);
    });

    test('request bodies omit the fields you did not set', () {
      expect(const UpdateLead(name: 'Ada').toJson(), {'name': 'Ada'});
      expect(const CreateTopup(amountUsd: 20).toJson(), {'amount_usd': 20.0});
      expect(
        CreateAppointment(
          phoneNumber: '+14155551234',
          dateTime: DateTime.utc(2026, 9, 2, 15, 30),
          agentId: 'ag1',
          leadId: 'ld1',
        ).toJson(),
        {
          'phone_number': '+14155551234',
          'date_time': '2026-09-02T15:30:00.000Z',
          'agent_id': 'ag1',
          'lead_id': 'ld1',
        },
      );
    });

    test('a bulk import reports the rows it refused, with their positions', () {
      final result = BulkLeadResult.fromJson({
        'object': 'bulk_result',
        'created_count': 1,
        'failed_count': 1,
        'data': [
          {
            'id': 'ld1',
            'object': 'lead',
            'name': 'Ada',
            'phone_number': '+14155551234',
            'tags': ['clinic'],
            'created_at': '2026-09-01T12:00:00.000Z',
          }
        ],
        'errors': [
          {'index': 1, 'phone_number': 'nonsense', 'error': 'not E.164'}
        ],
      });
      expect(result.createdCount, 1);
      expect(result.data.single.tags, ['clinic']);
      expect(result.errors.single.index, 1);
    });

    test('engines expose their priced models', () {
      final engines = EngineList.fromJson({
        'object': 'list',
        'data': [
          {
            'id': 'classic',
            'kind': 'composed',
            'available': true,
            'models': [
              {
                'component': 'stt',
                'model': 'deepgram/nova-3',
                'unit': 'second',
                'price_micros': 0.179
              }
            ],
          }
        ],
      });
      expect(engines.data.single.kind, EngineKind.composed);
      expect(engines.data.single.models.single.component, UsageComponent.stt);
    });
  });
}
