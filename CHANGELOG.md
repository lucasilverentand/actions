# Changelog

All three actions share one stable semantic version. Version tags are immutable.

## [1.1.0] - 2026-11-11

- Add `npm run release:prepare -- major|minor|patch` to update package metadata and reviewed release notes together.
- Publish version tags and GitHub Releases automatically after verification passes on main, using a repository-scoped workflow token.
- Reject stale runs, version rollbacks, and conflicting tags; leave published releases untouched on repeat runs.
- Preserve the existing v1.0.0 and v1.0.1 releases and document release preparation and recovery.

## [1.0.1] - 2026-11-11

- Colocate each action's manifest, source, tests, generated bundle, and usage reference.
- Separate shared helpers, fleet tooling, adoption examples, and repository documentation.
- Preserve public action paths and runtime behavior; verify relocated bundles in isolation.

## [1.0.0] - 2026-11-11

- Introduce PR title/body policy, read-only repository configuration auditing, and conservative merged-branch cleanup.
- Add local/private fleet inventory, pinned usage examples, CI checks, and security guidance.
