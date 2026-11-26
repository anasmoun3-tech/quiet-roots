#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { buildGraph } from '../src/graph.mjs';
import { analyze, compare, evaluate, explain } from '../src/report.mjs';

const usage = `Usage:
  quiet-roots scan [lockfile] [--production] [--json]
  quiet-roots why <package-name-or-path> [lockfile] [--production] [--json]
  quiet-roots check <policy.json> [lockfile] [--production] [--json]
  quiet-roots diff <before-lockfile> <after-lockfile> [--production] [--json]

The default lockfile is package-lock.json.
Exit codes: 0 success, 1 policy violation or no match, 2 input error.`;

async function readJson(path) {
  try {
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(path + ': ' + error.message);
  }
}

const label = ({ name, version }) => version ? name + '@' + version : name;
const json = value => console.log(JSON.stringify(value, null, 2));

async function main([command, ...args]) {
  if (!command || ['-h', '--help'].includes(command) || args.includes('--help')) {
    console.log(usage);
    return;
  }
  if (!['scan', 'why', 'check', 'diff'].includes(command)) throw new Error('Unknown command: ' + command);
  const flags = args.filter(arg => arg.startsWith('-'));
  if (flags.some(flag => !['--json', '--production'].includes(flag))) throw new Error('Unknown option.');
  const positional = args.filter(arg => !arg.startsWith('-'));
  const primary = command === 'scan' ? null : positional.shift();
  if ((command !== 'scan' && !primary) || positional.length > 1
      || (command === 'diff' && positional.length !== 1)) throw new Error(usage);
  const graph = buildGraph(await readJson(positional[0] ?? 'package-lock.json'));
  const options = { production: flags.includes('--production') };
  const machine = flags.includes('--json');
  if (command === 'why') {
    const matches = explain(graph, primary, options);
    if (machine) json(matches);
    else if (!matches.length) console.log('No reachable match for ' + primary);
    else for (const chain of matches) console.log(chain.map(label).join(' -> ') + ' [' + chain.at(-1).path + ']');
    if (!matches.length) process.exitCode = 1;
    return;
  }
  const report = analyze(graph, options);
  if (command === 'diff') {
    const before = analyze(buildGraph(await readJson(primary)), options);
    const diff = compare(before, report);
    if (machine) json(diff);
    else {
      console.log(diff.added.length + ' added, ' + diff.removed.length + ' removed, ' + diff.changed.length + ' changed');
      for (const pkg of diff.added) console.log('+ ' + pkg.path + ' ' + label(pkg));
      for (const pkg of diff.removed) console.log('- ' + pkg.path + ' ' + label(pkg));
      for (const { path, before, after } of diff.changed) {
        console.log('~ ' + path + ' ' + label(before) + ' via ' + before.roots.join(', ')
          + ' -> ' + label(after) + ' via ' + after.roots.join(', '));
      }
    }
    return;
  }
  if (command === 'check') {
    const violations = evaluate(report, await readJson(primary));
    if (machine) json({ passed: !violations.length, violations });
    else if (!violations.length) console.log('Dependency policy passed.');
    else for (const v of violations) console.log(v.key + ': ' + v.actual + ' exceeds ' + v.limit);
    if (violations.length) process.exitCode = 1;
    return;
  }
  if (machine) {
    json(report);
    return;
  }
  console.log('Mode: ' + report.mode);
  console.log('Reachable package locations: ' + report.packages.length);
  console.log('Packages with multiple versions: ' + report.duplicates.length);
  console.log('Unresolved declarations: ' + report.unresolved.length);
  for (const pkg of report.packages.slice(0, 20)) {
    console.log('  ' + label(pkg) + ' [' + pkg.path + '] via ' + pkg.roots.join(', '));
  }
  if (report.packages.length > 20) console.log('Use --json for all package locations.');
  for (const entry of report.duplicates) console.log('  Versions of ' + entry.name + ': ' + entry.versions.join(', '));
  for (const edge of report.unresolved) console.log('  Unresolved ' + edge.kind + ': ' + edge.name + ' from ' + (edge.from || '(root)'));
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
