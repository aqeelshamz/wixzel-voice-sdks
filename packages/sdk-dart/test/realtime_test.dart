import 'dart:convert';
import 'dart:typed_data';

import 'package:test/test.dart';
import 'package:wixzel_voice/wixzel_voice.dart';

void main() {
  group('µ-law', () {
    test('round-trips speech-range samples within G.711 precision', () {
      final pcm = Int16List.fromList([0, 1000, -1000, 8000, -8000, 30000, -30000]);
      final back = mulawToPcm16(pcm16ToMulaw(pcm));
      for (var i = 0; i < pcm.length; i++) {
        // µ-law is logarithmic: the error grows with the amplitude, ~3%.
        expect((back[i] - pcm[i]).abs(), lessThanOrEqualTo(pcm[i].abs() ~/ 16 + 8));
      }
    });

    test('encodes silence as 0xFF, the wire value for zero', () {
      expect(pcm16ToMulaw(Int16List(3)), [0xff, 0xff, 0xff]);
    });
  });

  group('events', () {
    test('parse every frame type the server sends', () {
      expect(RealtimeEvent.fromJson({'type': 'session.started', 'call_id': 'rt-1', 'max_duration_seconds': 600}),
          isA<RealtimeStarted>().having((e) => e.callId, 'callId', 'rt-1'));
      expect(RealtimeEvent.fromJson({'type': 'audio', 'audio': base64Encode([1, 2])}),
          isA<RealtimeAudio>().having((e) => e.mulaw, 'mulaw', [1, 2]));
      expect(RealtimeEvent.fromJson({'type': 'audio.clear'}), isA<RealtimeAudioClear>());
      expect(RealtimeEvent.fromJson({'type': 'transcript', 'role': 'user', 'text': 'hi'}),
          isA<RealtimeTranscript>().having((e) => e.text, 'text', 'hi'));
      expect(RealtimeEvent.fromJson({'type': 'error', 'code': 'insufficient_credits', 'message': 'x'}),
          isA<RealtimeError>().having((e) => e.code, 'code', 'insufficient_credits'));
      expect(RealtimeEvent.fromJson({'type': 'session.ended', 'reason': 'agent', 'duration_seconds': 42}),
          isA<RealtimeEnded>().having((e) => e.durationSeconds, 'durationSeconds', 42));
      expect(RealtimeEvent.fromJson({'type': 'something.new'}), isA<RealtimeUnknownEvent>());
    });
  });

  test('a minted session parses', () {
    final s = RealtimeSession.fromJson({
      'id': 'rt-abc', 'object': 'realtime_session',
      'client_secret': {'value': 'rt_secret_x', 'expires_at': '2026-09-12T10:00:00.000Z'},
      'url': 'wss://api.voice.wixzel.com/v1/realtime', 'agent_id': 'a1', 'engine': 'gemini_live',
      'max_duration_seconds': 600, 'audio_format': 'mulaw_8000',
    });
    expect(s.clientSecret, 'rt_secret_x');
    expect(s.expiresAt.isUtc, isTrue);
  });
}
