# Contributing

Use Node.js 24 or newer. Install dependencies with `npm ci --ignore-scripts`, then run `npm run build`, `npm test`, and `npm run check`. Commit changed bundles in each action's `dist/` folder alongside its source. CI checks that a fresh build produces the same files.

Each public action owns its `action.yml`, `README.md`, `src/`, `test/`, and generated `dist/`. Put shared API and runner helpers in `lib/`, standalone operator tools in `tools/`, and build checks in `scripts/`. Add adoption examples in `docs/examples/`. See the [repository map](../docs/architecture.md) for the dependency boundaries.

Pull requests need a Conventional Commit title whose summary after the type and scope fits 72 characters including GitHub's ` (#number)` suffix, Conventional Commit messages on every commit, and meaningful `## Summary` and `## Testing` sections. The PR policy check enforces the title and commit messages; reviewers check the sections. Explain the outcome, verification, and any relevant limitations. Security-sensitive behavior needs tests covering rejection and race conditions.

Keep public examples generic. Do not add repository inventories, private findings, credentials, internal hostnames, or exceptions belonging to a particular deployment.

Versions and releases are automatic after ordinary PRs merge and CI passes on main. Use `feat` for a minor bump, `!` or a breaking-change footer for a major bump, and other Conventional Commit types for a patch. No version PR, package-version edit, or local command is required. See the [release guide](../docs/releases.md) for classification and recovery rules. Do not move published version tags. Review source and bundle changes together before merging, and update example pins separately when appropriate.
