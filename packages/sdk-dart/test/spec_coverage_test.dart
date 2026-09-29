@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';
import 'package:wixzel_voice/wixzel_voice.dart';

/// The SDK is hand-written; this is what keeps it honest against the API.
void main() {
  final specFile = File('../../docs/openapi.json');
  final client = WixzelVoice(apiKey: 'wv_test_x');

  group('spec coverage', () {
    late Map<String, dynamic> spec;
    late Set<String> operations;

    setUpAll(() {
      if (!specFile.existsSync()) {
        return;
      }
      spec = jsonDecode(specFile.readAsStringSync()) as Map<String, dynamic>;
      const httpMethods = {'get', 'post', 'put', 'patch', 'delete'};
      operations = {
        for (final entry in (spec['paths'] as Map<String, dynamic>).entries)
          for (final method in (entry.value as Map<String, dynamic>).keys)
            if (httpMethods.contains(method))
              '${method.toUpperCase()} ${entry.key}',
      };
    });

    test('every operation has exactly one method, and every method is real',
        () {
      if (!specFile.existsSync()) {
        return markTestSkipped('docs/openapi.json not reachable');
      }
      final missing =
          operations.where((op) => !kOperations.containsKey(op)).toList();
      final phantom =
          kOperations.keys.where((op) => !operations.contains(op)).toList();
      final values = kOperations.values.toList();
      final duplicates =
          values.where((v) => values.where((o) => o == v).length > 1).toSet();

      expect(missing, isEmpty,
          reason: 'operations with no SDK method: $missing');
      expect(phantom, isEmpty,
          reason: 'SDK names an endpoint the spec lacks: $phantom');
      expect(duplicates, isEmpty,
          reason: 'two operations share a method: $duplicates');
      expect(kOperations.length, operations.length);
    });

    test('every table value resolves to a real method', () {
      final methods = operationMethods(client);
      for (final name in kOperations.values) {
        expect(methods[name], isNotNull,
            reason: '$name is not wired in operationMethods');
      }
      for (final alias in kOperationAliases) {
        expect(methods[alias], isNotNull,
            reason: '$alias is not wired in operationMethods');
      }
      // Nothing in the mapping that the table and the aliases do not name.
      final known = {...kOperations.values, ...kOperationAliases};
      expect(methods.keys.where((k) => !known.contains(k)), isEmpty);
    });

    test('each resource file calls the verb and path its table entry claims',
        () {
      final dir = Directory('lib/src/resources');
      if (!dir.existsSync()) {
        return markTestSkipped('resources not reachable');
      }
      final sources = {
        for (final file in dir.listSync().whereType<File>())
          file.uri.pathSegments.last.replaceAll('.dart', ''):
              file.readAsStringSync(),
      };
      // resource name in the table -> file name, e.g. knowledgeBases -> knowledge_bases
      String fileFor(String resource) => resource.replaceAllMapped(
          RegExp('[A-Z]'), (m) => '_${m[0]!.toLowerCase()}');

      for (final entry in kOperations.entries) {
        final parts = entry.key.split(' ');
        final verb = parts[0];
        final path = parts[1];
        final resource = entry.value.split('.').first;
        final source = sources[fileFor(resource)];
        expect(source, isNotNull, reason: 'no source file for $resource');
        final staticPrefix =
            path.split('{').first.replaceAll(RegExp(r'/$'), '');
        expect(source, contains(staticPrefix),
            reason: '${entry.value} should reference $staticPrefix');
        // A cursor list goes through transport.list(), which is GET by definition.
        final sendsVerb = source!.contains("'$verb'") ||
            (verb == 'GET' && source.contains('.list('));
        expect(sendsVerb, isTrue, reason: '${entry.value} should send $verb');
      }
    });

    test('the scope enum matches the API exactly', () {
      if (!specFile.existsSync()) {
        return markTestSkipped('docs/openapi.json not reachable');
      }
      final schemas = (spec['components'] as Map<String, dynamic>)['schemas']
          as Map<String, dynamic>;
      final createApiKey = schemas['CreateApiKey'] as Map<String, dynamic>;
      final properties = createApiKey['properties'] as Map<String, dynamic>;
      final scopes = (properties['scopes'] as Map<String, dynamic>)['items']
          as Map<String, dynamic>;
      final expected = (scopes['enum'] as List<dynamic>).cast<String>();
      final actual = ApiScope.values
          .where((s) => s != ApiScope.unknown)
          .map((s) => s.value)
          .toList();
      expect(actual, expected);
    });

    test('the version constant matches pubspec.yaml', () {
      final pubspec = File('pubspec.yaml');
      if (!pubspec.existsSync()) {
        return markTestSkipped('pubspec.yaml not reachable');
      }
      final match = RegExp(r'^version:\s*(.+)$', multiLine: true)
          .firstMatch(pubspec.readAsStringSync());
      expect(match?.group(1)?.trim(), packageVersion);
    });
  });
}
