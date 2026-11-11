# Contributing

Use Node.js 24 or newer. Install dependencies with `npm ci --ignore-scripts`, then run `npm run build`, `npm test`, and `npm run check`. Commit changed bundles in each action's `dist/` folder alongside its source. CI checks that a fresh build produces the same files.

Each public action owns its `action.yml`, `README.md`, `src/`, `test/`, and generated `dist/`. Put shared API and runner helpers in `lib/`, standalone operator tools in `tools/`, and build checks in `scripts/`. Add adoption examples in `docs/examples/`. See the [repository map](../docs/architecture.md) for the dependency boundaries.

Pull requests need a Conventional Commit title and meaningful `## Summary` and `## Testing` sections. Explain the outcome, verification, and any relevant limitations. Security-sensitive behavior needs tests covering rejection and race conditions.

Keep public examples generic. Do not add repository inventories, private findings, credentials, internal hostnames, or exceptions belonging to a particular deployment.

To release, run `npm run release:prepare -- patch`, `minor`, or `major` from a clean release branch after fetching tags. Review and commit the package files and changelog together. CI publishes the new version after the PR merges and verification passes on main. See the [release guide](../docs/releases.md) for the full process and recovery rules. Do not move published version tags. Review source and bundle changes together before releasing, and update example pins separately when appropriate.
