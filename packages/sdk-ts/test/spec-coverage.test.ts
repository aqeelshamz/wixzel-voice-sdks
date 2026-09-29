import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATIONS, SCOPES, VERSION, WixzelVoice } from '../src/index.js';
import { USER_AGENT } from '../src/version.js';

/**
 * The SDK is hand-written; this is what keeps it honest against the API.
 * Every operation in docs/openapi.json must map to exactly one method, every
 * method must name a real operation, and each must call what it claims.
 */
const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(resolve(here, '../../../docs/openapi.json'), 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: { CreateApiKey: { properties: { scopes: { items: { enum: string[] } } } } } };
};
const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { version: string; name: string };

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const RESOURCES = [
    'engines', 'agents', 'calls', 'leads', 'campaigns', 'knowledgeBases',
    'phoneNumbers', 'sipTrunks', 'appointments', 'usage', 'billing', 'apiKeys',
    'webhooks', 'realtime',
] as const;

const client = new WixzelVoice({ apiKey: 'wv_test_x', fetch: (() => Promise.reject(new Error('no'))) as typeof fetch });

describe('spec coverage', () => {
    test('every OpenAPI operation has exactly one method, and every method names a real operation', () => {
        const operations = new Set<string>();
        for (const [path, methods] of Object.entries(spec.paths)) {
            for (const method of Object.keys(methods)) {
                if (HTTP_METHODS.has(method)) operations.add(`${method.toUpperCase()} ${path}`);
            }
        }
        const keys = Object.keys(OPERATIONS);
        const missing = [...operations].filter((op) => !keys.includes(op));
        const phantom = keys.filter((k) => !operations.has(k));
        const values = Object.values(OPERATIONS);
        const duplicates = values.filter((v, i) => values.indexOf(v) !== i);

        assert.deepEqual(missing, [], `operations in docs/openapi.json with no SDK method: ${missing.join(', ')}`);
        assert.deepEqual(phantom, [], `SDK table names an endpoint the spec does not have: ${phantom.join(', ')}`);
        assert.deepEqual(duplicates, [], `two operations map to the same method: ${duplicates.join(', ')}`);
        assert.equal(keys.length, operations.size);
    });

    test('each named method exists on the client and calls the verb and path it claims', () => {
        for (const [operation, name] of Object.entries(OPERATIONS)) {
            const [verb, path] = operation.split(' ') as [string, string];
            const [ns, method] = name.split('.') as [keyof WixzelVoice, string];
            const resource = client[ns] as unknown as Record<string, unknown>;
            const fn = resource?.[method];
            assert.equal(typeof fn, 'function', `${name} is not a method on the client`);
            const source = (fn as () => void).toString();
            // The transpiler may rewrite quotes, so accept either style. A
            // cursor list goes through http.list(), which is GET by definition.
            const sendsVerb = source.includes(`'${verb}'`) || source.includes(`"${verb}"`) || (verb === 'GET' && source.includes('.list('));
            assert.ok(sendsVerb, `${name} should send ${verb}`);
            const staticPrefix = path.split('{')[0]!.replace(/\/$/, '');
            assert.ok(source.includes(staticPrefix), `${name} should reference ${staticPrefix}`);
        }
    });

    test('no resource has a public method the table does not know about', () => {
        const known = new Set(Object.values(OPERATIONS) as string[]);
        for (const ns of RESOURCES) {
            const proto = Object.getPrototypeOf(client[ns]) as object;
            for (const method of Object.getOwnPropertyNames(proto)) {
                if (method === 'constructor') continue;
                assert.ok(known.has(`${ns}.${method}`), `${ns}.${method} is public but not in OPERATIONS`);
            }
        }
        assert.equal(RESOURCES.length, new Set(Object.values(OPERATIONS).map((v) => v.split('.')[0])).size);
    });

    test('the scope list matches the API enum exactly', () => {
        assert.deepEqual([...SCOPES], spec.components.schemas.CreateApiKey.properties.scopes.items.enum);
    });

    test('the version constant matches package.json', () => {
        assert.equal(VERSION, pkg.version);
        assert.equal(pkg.name, 'wixzel-voice');
        assert.ok(USER_AGENT.startsWith('wixzel-voice/'));
    });
});
