import 'package:test/test.dart';
import 'package:wixzel_voice/wixzel_voice.dart';

import 'helpers.dart';

void main() {
  final api = FakeApi();
  setUp(api.reset);

  group('pagination', () {
    test('a list is a Page with data, hasMore and nextCursor', () async {
      final client = api.wixzel();
      api.queue.add(listPage(['a', 'b'], 'cur1'));
      final page =
          await client.calls.list(limit: 2, status: CallStatus.completed);
      expect(page.data.map((c) => c.id), ['a', 'b']);
      expect(page.hasMore, isTrue);
      expect(page.nextCursor, 'cur1');
      expect(api.last.query, {'limit': '2', 'status': 'completed'});
    });

    test(
        'autoPaging walks every page, chaining the cursor and keeping the query',
        () async {
      final client = api.wixzel();
      api.queue.addAll([
        listPage(['a', 'b'], 'cur1'),
        listPage(['c'], 'cur2'),
        listPage(['d'], null),
      ]);
      final page =
          await client.calls.list(limit: 2, status: CallStatus.completed);
      final seen = await page.autoPaging().map((c) => c.id).toList();
      expect(seen, ['a', 'b', 'c', 'd']);
      expect(api.requests, hasLength(3));
      expect(api.requests[1].query,
          {'limit': '2', 'status': 'completed', 'starting_after': 'cur1'});
      expect(api.requests[2].query,
          {'limit': '2', 'status': 'completed', 'starting_after': 'cur2'});
    });

    test('nextPage returns null at the end and pages() yields each page',
        () async {
      final client = api.wixzel();
      api.queue.addAll([
        listPage(['a'], 'cur1'),
        listPage(['b'], null)
      ]);
      final first = await client.leads.list();
      final second = await first.nextPage();
      expect(second, isNotNull);
      expect(second!.hasMore, isFalse);
      expect(await second.nextPage(), isNull);

      api.reset();
      api.queue.addAll([
        listPage(['a'], 'cur1'),
        listPage(['b'], null)
      ]);
      final start = await client.leads.list();
      final sizes = await start.pages().map((p) => p.data.length).toList();
      expect(sizes, [1, 1]);
    });

    test('auto-paging forward drops an endingBefore the caller passed',
        () async {
      final client = api.wixzel();
      api.queue.addAll([
        listPage(['a'], 'cur1'),
        listPage(['b'], null)
      ]);
      final page = await client.leads.list(endingBefore: 'old');
      expect(api.last.query, {'ending_before': 'old'});
      await page.nextPage();
      expect(api.last.query, {'starting_after': 'cur1'});
    });

    test('SIP logs are not a Page; they carry lastId', () async {
      final client = api.wixzel();
      api.queue.add(Scripted(body: {
        'object': 'list',
        'data': [
          {
            'id': 4,
            'level': 'warn',
            'message': 'carrier rejected',
            'at': '2026-09-01T12:00:00.000Z'
          }
        ],
        'last_id': 7,
      }));
      final logs = await client.sipTrunks.logs('st1', sinceId: 3);
      expect(logs.lastId, 7);
      expect(logs.data.single.message, 'carrier rejected');
      expect(api.last.query, {'since_id': '3'});
    });
  });
}
