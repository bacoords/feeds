import assert from 'node:assert/strict';
import { schema } from '../server/schema.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { analyzeZeroSource, compileZeroCapsule } from '@spacefast/zero-compile';
const root = process.cwd();
const config = JSON.parse(await readFile('sf.jsonc', 'utf8'));
const analysis = await analyzeZeroSource(root, config.runtime);
assert.deepEqual(analysis.tables.sort(), Object.keys(schema).sort(), 'Compiler must see every table');
for (const [name, definition] of Object.entries(schema)) {
  assert.deepEqual(analysis.schema[name].columns.map(column => column.name).sort(), Object.keys(definition.fields).sort(), `Schema field mismatch: ${name}`);
  assert.deepEqual(analysis.schema[name].indexes, definition.indexes, `Schema index mismatch: ${name}`);
}
const result = await compileZeroCapsule({ root, analysis, appName: 'Feeds', previousSchema: null, migrationMode: 'safe', shellTitle: 'Feeds', linkThemeStylesheet: false, inspectPolicy: 'private', runnerSha256: null, centralRealtimeUrl: null });
await mkdir('.artifacts', { recursive: true });
await writeFile('.artifacts/zero-build.json', JSON.stringify(result));
console.log('Zero capsule compiled using @spacefast/zero-compile 0.8.0. This is not a deployment or runtime test.');
