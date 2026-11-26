function enabled(edge, production) {
  return !production || edge.kind !== 'dev';
}

function walk(graph, start, production) {
  const previous = new Map([[start, null]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    for (const edge of graph.get(queue[index]).edges) {
      if (!enabled(edge, production) || previous.has(edge.to)) continue;
      previous.set(edge.to, queue[index]);
      queue.push(edge.to);
    }
  }
  return previous;
}

export function analyze(graph, { production = false } = {}) {
  const reachable = walk(graph, '', production);
  const direct = graph.get('').edges.filter(edge => enabled(edge, production));
  const roots = new Map([...reachable.keys()].map(path => [path, []]));
  for (const edge of direct) {
    for (const path of walk(graph, edge.to, production).keys()) {
      if (path) roots.get(path)?.push(edge.name);
    }
  }
  const packages = [];
  const unresolved = [];
  for (const path of reachable.keys()) {
    const node = graph.get(path);
    for (const missing of node.missing.filter(edge => enabled(edge, production))) {
      unresolved.push({ from: path, ...missing });
    }
    if (!path) continue;
    packages.push({
      path,
      name: node.name,
      version: node.version,
      direct: direct.some(edge => edge.to === path),
      roots: roots.get(path),
    });
  }
  packages.sort((a, b) => b.roots.length - a.roots.length || a.path.localeCompare(b.path));
  const versions = new Map();
  for (const pkg of packages) {
    if (pkg.version === null) continue;
    if (!versions.has(pkg.name)) versions.set(pkg.name, new Set());
    versions.get(pkg.name).add(pkg.version);
  }
  const duplicates = [...versions].filter(([, values]) => values.size > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, values]) => ({ name, versions: [...values].sort() }));
  return { mode: production ? 'production' : 'all', packages, duplicates, unresolved };
}

export function explain(graph, target, { production = false } = {}) {
  const previous = walk(graph, '', production);
  const matches = [];
  for (const path of previous.keys()) {
    const node = graph.get(path);
    if (!path || (node.name !== target && path !== target)) continue;
    const chain = [];
    for (let cursor = path; cursor !== null; cursor = previous.get(cursor)) {
      const { name, version } = graph.get(cursor);
      chain.push({ path: cursor, name, version });
    }
    matches.push(chain.reverse());
  }
  return matches;
}

export function evaluate(report, policy) {
  const allowed = ['maxPackages', 'maxDuplicateNames', 'maxUnresolved'];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || !Object.keys(policy).length) {
    throw new Error('Policy must be a nonempty JSON object.');
  }
  const counts = {
    maxPackages: report.packages.length,
    maxDuplicateNames: report.duplicates.length,
    maxUnresolved: report.unresolved.filter(edge => !edge.kind.startsWith('optional')).length,
  };
  const violations = [];
  for (const [key, limit] of Object.entries(policy)) {
    if (!allowed.includes(key) || !Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('Invalid policy setting: ' + key);
    }
    if (counts[key] > limit) violations.push({ key, limit, actual: counts[key] });
  }
  return violations;
}

export function compare(before, after) {
  const oldPackages = new Map(before.packages.map(pkg => [pkg.path, pkg]));
  const newPackages = new Map(after.packages.map(pkg => [pkg.path, pkg]));
  const added = [];
  const removed = [];
  const changed = [];
  const paths = [...new Set([...oldPackages.keys(), ...newPackages.keys()])].sort();
  for (const path of paths) {
    const previous = oldPackages.get(path);
    const current = newPackages.get(path);
    if (!previous) added.push(current);
    else if (!current) removed.push(previous);
    else if (previous.version !== current.version || previous.name !== current.name
        || previous.direct !== current.direct || previous.roots.join('\n') !== current.roots.join('\n')) {
      changed.push({ path, before: previous, after: current });
    }
  }
  return { mode: after.mode, added, removed, changed };
}
