# Repository structure

The root action directories are the public interface. Their names appear in consumers' `uses:` references, so they remain stable. Each owns its implementation, tests, reference documentation, and runnable bundle.

```text
.github/                     CI, nightly jobs, dependency updates, community policies
workflow-policy/             Pre-merge workflow inspection
  action.yml                 Inputs, outputs, and Node entry point
  README.md                  Usage and policy reference
  src/index.mjs              Editable implementation
  test/                      Policy tests
  dist/index.mjs             Generated bundle GitHub runs
repository-audit/            Same structure; also owns src/workflows.mjs
branch-cleanup/              Same structure; includes deletion-lease tests
fleet-audit/                 Private scheduled inventory and reporting
ci-gate/                     Upstream job gate
release/                     Semantic release preview and publication
lib/                         Shared GitHub API and Actions runtime helpers
  test/                      Shared helper tests
tools/
  fleet-audit/               Local/private CLI, scoped personal/org discovery, docs, and tests
scripts/                     Build and repository validation utilities
  release/                   Automatic version planning, guarded publication, and tests
test/                        Integration checks for the published action packages
docs/
  getting-started.md          Walkthrough and adoption steps
  automation.md              What this repository runs itself
  releases.md                Automatic semantic versions and publication
  examples/                  Copyable workflows for consuming repositories
  legal/                     Bundled dependency license notices
README.md                    Starting point and links
LICENSE                      Repository license
CHANGELOG.md                 Historical notes and links to automatic GitHub release notes
package.json                 One set of dependencies and development commands
package-lock.json            Locked dependency versions and integrity hashes
```

## How an action runs

A consumer references `seventwo-studio/actions/workflow-policy@<full-commit-sha>`. GitHub reads `workflow-policy/action.yml`, which points to `workflow-policy/dist/index.mjs`. That committed bundle includes the code and its JavaScript dependencies, so the consumer needs no npm installation or checkout of their repository.

Maintainers edit `src/` and run the root build command. The build combines that source with shared `lib/` helpers and writes each action's bundle. Generated files are committed so GitHub can execute them directly; `.gitattributes` marks them as generated to reduce review clutter. They are still checked against a fresh build in CI.

The runtime bundle is a build artifact, not a second implementation to edit. Dependency notices live in `docs/legal/THIRD_PARTY_NOTICES` and ship with the repository.

## Dependency boundaries

The actions share the GitHub API client and input/output helpers in `lib/`. Workflow YAML inspection belongs to `repository-audit/src/` because it is part of that action's policy. Workflow and branch policies remain in their own action folders.

The fleet tool imports the repository audit's source to reuse exactly the same checks. Its inventory discovery and command-line behavior live under `tools/fleet-audit/`; the fleet action imports its reusable core without the CLI entry point. Build and consistency checks in `scripts/` are development utilities.

Tests live beside the code they exercise. Root `test/` checks the packaged actions as consumers receive them, including loading the generated bundles from an isolated directory without `node_modules`.

One root package and lockfile cover the repository. Separate npm packages or workspaces would add release and installation steps without providing useful isolation for these small actions.

## Compatibility

Published action paths, inputs, outputs, and behavior are versioned together. Existing commit pins and the `v1.0.0` release continue to address the original immutable tree.

The fleet command's current source path is `tools/fleet-audit/index.mjs`; the old `scripts/audit-owner.mjs` path remains in older pinned versions. Adoption examples now live in `docs/examples/`.

## Private local files

`reports/` holds locally generated fleet findings and is ignored by Git. `node_modules/` is also ignored and recreated from the lockfile. Neither belongs in the public source tree. The shared configuration in this repository must remain generic; account inventories, credentials, internal endpoints, and deployment-specific exceptions belong in consuming repositories or private tooling.

## Organization ownership

The canonical repository is `seventwo-studio/actions`. Use that owner in workflow references, documentation links, and Git remotes. A transfer preserves repository history, tags, and release commits; existing SHA pins can be reused under the new owner. Update callers explicitly rather than relying on redirects for action resolution.

The fleet tool retains personal discovery by default and supports organization discovery with `--org ORGANIZATION`. Public library ownership does not grant it access to private organization repositories. Keep cross-repository audit credentials and findings in a private controller.
