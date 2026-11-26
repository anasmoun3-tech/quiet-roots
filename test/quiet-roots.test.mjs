import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildGraph } from '../src/graph.mjs';
import { analyze, compare, evaluate, explain } from '../src/report.mjs';

const fixturePath = fileURLToPath(new URL('../examples/package-lock.example.json', import.meta.url));
const cliPath = fileURLToPath(new URL('../bin/quiet-roots.mjs', import.meta.url));
const policyPath = fileURLToPath(new URL('../examples/policy.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

test('traces shared dependencies and nested versions to their direct roots', () => {
  const graph = buildGraph({ ...fixture, lockfileVersion: 2 });
  const report = analyze(graph);
  assert.deepEqual(report.packages.find(pkg => pkg.name === 'shared').roots, ['gateway', 'worker']);
  assert.deepEqual(report.duplicates, [{ name: 'parser', versions: ['1.0.0', '2.0.0'] }]);
  assert.deepEqual(explain(graph, 'parser').map(chain => chain.map(pkg => pkg.name)), [
    ['demo-app', 'test-runner', 'parser'],
    ['demo-app', 'worker', 'parser'],
  ]);
  assert.equal(analyze(graph, { production: true }).packages.length, 4);
});

test('follows workspace links and ends traversal when dependencies form a cycle', () => {
  const graph = buildGraph({ lockfileVersion: 3, packages: {
    '': { workspaces: ['packages/*'] },
    'node_modules/@demo/app': { link: true, resolved: 'packages/app' },
    'packages/app': { name: '@demo/app', version: '1', dependencies: { helper: '*' } },
    'node_modules/helper': { version: '1', dependencies: { '@demo/app': '*' } },
  } });
  assert.equal(analyze(graph).packages.length, 3);
  assert.deepEqual(explain(graph, 'helper')[0].map(pkg => pkg.path), [
    '', 'node_modules/@demo/app', 'packages/app', 'node_modules/helper',
  ]);
});

test('resolves scoped peers beside their requester and excludes missing optional edges from limits', () => {
  const graph = buildGraph({ lockfileVersion: 3, packages: {
    '': { dependencies: { parent: '*' } },
    'node_modules/parent': { dependencies: { '@demo/plugin': '*' } },
    'node_modules/parent/node_modules/@demo/plugin': {
      peerDependencies: { peer: '*', missing: '*' },
      peerDependenciesMeta: { missing: { optional: true } },
      optionalDependencies: { platform: '*' },
    },
    'node_modules/parent/node_modules/peer': { version: '1' },
    'node_modules/parent/node_modules/@demo/plugin/node_modules/peer': { version: '2' },
  } });
  assert.equal(explain(graph, 'peer')[0].at(-1).version, '1');
  const report = analyze(graph);
  assert.equal(report.unresolved.length, 2);
  assert.deepEqual(evaluate(report, { maxUnresolved: 0 }), []);
  assert.throws(() => evaluate(report, { unsupported: 0 }), /Invalid policy/);
});

test('reports added and removed locations and version or root changes', () => {
  const updated = structuredClone(fixture);
  updated.packages['node_modules/gateway'].dependencies = { extra: '*' };
  updated.packages['node_modules/extra'] = { version: '1' };
  updated.packages['node_modules/shared'].version = '2';
  delete updated.packages['node_modules/test-runner/node_modules/parser'];
  const result = compare(analyze(buildGraph(fixture)), analyze(buildGraph(updated)));
  assert.deepEqual(result.added.map(pkg => pkg.name), ['extra']);
  assert.deepEqual(result.removed.map(pkg => pkg.name), ['parser']);
  assert.deepEqual(result.changed.map(pkg => pkg.path), ['node_modules/parser', 'node_modules/shared']);
});

test('CLI returns machine-readable output and distinguishes policy failures from input errors', () => {
  const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
  const passing = run('check', policyPath, fixturePath, '--production', '--json');
  assert.equal(passing.status, 0, passing.stderr);
  assert.equal(JSON.parse(passing.stdout).passed, true);
  const failing = run('check', policyPath, fixturePath, '--json');
  assert.equal(failing.status, 1);
  assert.equal(JSON.parse(failing.stdout).passed, false);
  const diff = run('diff', fixturePath, fixturePath, '--json');
  assert.equal(diff.status, 0, diff.stderr);
  assert.deepEqual(JSON.parse(diff.stdout).changed, []);
  assert.equal(run('scan', 'missing-lockfile.json').status, 2);
  assert.equal(run('why', 'unknown-package', fixturePath).status, 1);
});
