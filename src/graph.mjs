import { posix } from 'node:path';

export function buildGraph(lock) {
  if (![2, 3].includes(lock?.lockfileVersion) || !lock.packages?.['']) {
    throw new Error('Expected an npm package-lock.json with lockfileVersion 2 or 3 and a root package.');
  }
  const nodes = new Map(Object.entries(lock.packages).map(([path, pkg]) => [path, {
    path,
    name: pkg.name ?? (path.split(/(?:^|\/)node_modules\//).at(-1) || lock.name || '(root)'),
    version: pkg.version ?? null,
    edges: [],
    missing: [],
  }]));

  function locate(from, name) {
    let directory = from;
    for (;;) {
      if (posix.basename(directory) !== 'node_modules') {
        const candidate = posix.join(directory, 'node_modules', name);
        if (nodes.has(candidate)) return candidate;
      }
      if (!directory) return null;
      const parent = posix.dirname(directory);
      directory = parent === '.' ? '' : parent;
    }
  }

  for (const [path, pkg] of Object.entries(lock.packages)) {
    const node = nodes.get(path);
    if (pkg.link) {
      const target = typeof pkg.resolved === 'string' ? posix.normalize(pkg.resolved) : null;
      if (target && nodes.has(target)) node.edges.push({ name: node.name, to: target, kind: 'link' });
      else node.missing.push({ name: node.name, kind: 'link' });
      continue;
    }

    const declarations = new Map();
    for (const [field, kind] of [
      ['peerDependencies', 'peer'],
      ['devDependencies', 'dev'],
      ['dependencies', 'runtime'],
      ['optionalDependencies', 'optional'],
    ]) {
      // Development dependencies of installed third-party packages are not installed.
      if (kind === 'dev' && /(?:^|\/)node_modules(?:\/|$)/.test(path)) continue;
      for (const name of Object.keys(pkg[field] ?? {})) {
        const effectiveKind = kind === 'peer' && pkg.peerDependenciesMeta?.[name]?.optional
          ? 'optional-peer'
          : kind;
        declarations.set(name, effectiveKind);
      }
    }
    const workspacePatterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (!path && workspacePatterns?.length) {
      for (const [candidate, entry] of Object.entries(lock.packages)) {
        if (!entry.link || !/^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(candidate)) continue;
        const target = typeof entry.resolved === 'string' ? posix.normalize(entry.resolved) : '';
        if (target && !target.startsWith('../') && !/(?:^|\/)node_modules(?:\/|$)/.test(target)
            && nodes.has(target) && !declarations.has(nodes.get(candidate).name)) {
          declarations.set(nodes.get(candidate).name, 'workspace');
        }
      }
    }
    for (const [name, kind] of [...declarations].sort(([a], [b]) => a.localeCompare(b))) {
      // Peers resolve next to the package, rather than inside its private dependencies.
      const from = kind.endsWith('peer') && path ? posix.dirname(path.replace(/@[^/]+\/[^/]+$/, '@scope')) : path;
      const to = locate(from === '.' ? '' : from, name);
      if (to === null) node.missing.push({ name, kind });
      else node.edges.push({ name, to, kind });
    }
  }
  return nodes;
}
