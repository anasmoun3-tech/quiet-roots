# Quiet Roots

Quiet Roots reads an npm lockfile and tells you which packages your project depends on, how they got there, and which direct dependencies share them. It runs locally with Node.js 22 or newer and has zero runtime dependencies.

## Run it

```sh
npm test
npm run demo
node bin/quiet-roots.mjs scan path/to/package-lock.json --production
node bin/quiet-roots.mjs why shared examples/package-lock.example.json
node bin/quiet-roots.mjs check examples/policy.json examples/package-lock.example.json --production
```

Use `npm link` from the checkout to make the `quiet-roots` command available on your PATH.

## Commands

| Command | Output |
| --- | --- |
| `scan [lockfile]` | Reachable package locations, direct dependency relationships, duplicate versions, and unresolved declarations. |
| `why <name-or-path> [lockfile]` | One shortest path from the root project to each matching reachable location. |
| `check <policy.json> [lockfile]` | Pass or fail against a dependency budget. |
| `diff <before-lockfile> <after-lockfile>` | Added, removed, and changed package locations, including changes in which direct dependencies reach them. |

Each command supports `--json` and `--production`. Production mode skips development edges. The default lockfile is `package-lock.json`. `why` exits with 1 if it finds no match, and `check` exits with 1 when a limit is exceeded. Input errors exit with 2.

The demo shows `shared@1.0.0` reachable through both `gateway` and `worker`. It also shows two versions of `parser`, one in the production graph and one reachable through a development dependency.

## Dependency budgets

Commit a policy file to the project you want to track and run `check` in CI. All thresholds are inclusive, and you can omit any threshold.

| Setting | What it counts |
| --- | --- |
| `maxPackages` | Reachable package locations, including workspace links and their targets. |
| `maxDuplicateNames` | Package names with more than one reachable version. |
| `maxUnresolved` | Unresolved declarations, excluding optional dependencies and optional peers. |

## Review a lockfile change

From the project you want to inspect, save the base branch's lockfile and compare it with the current checkout. Replace `origin/main` with your pull request's base branch if it differs.

```sh
git show origin/main:package-lock.json > before-lock.json
quiet-roots diff before-lock.json package-lock.json --production
```

A changed location can keep the same version while becoming reachable through another direct dependency. Run `quiet-roots why <package-name> --production` to see a path to each matching location in the current lockfile.

## Scope

Quiet Roots analyzes npm lockfiles using format v2 or v3. It follows nested installs, hoisted dependencies, peers, and local links recorded in the lockfile. It models the recorded graph, so optional packages can appear even on platforms where npm would skip their installation. It does not query registries or inspect the installed filesystem. Counts measure graph structure and do not score package quality, security, or maintainer health.

## Development

`src/graph.mjs` resolves dependency edges. `src/report.mjs` traverses the graph and evaluates budgets. `bin/quiet-roots.mjs` handles command-line input and output. Tests use Node's built-in test runner.
