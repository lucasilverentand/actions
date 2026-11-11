# Repository structure

The three root action directories are the public interface. Their names appear in consumers' `uses:` references, so they remain stable. Each owns its implementation, tests, reference documentation, and runnable bundle.

```text
.github/                     CI, nightly jobs, dependency updates, community policies
pr-policy/                   PR metadata checks
  action.yml                 Inputs, outputs, and Node entry point
  README.md                  Usage and policy reference
  src/index.mjs              Editable implementation
  test/                      Policy tests
  dist/index.mjs             Generated bundle GitHub runs
repository-audit/            Same structure; also owns src/workflows.mjs
branch-cleanup/              Same structure; includes deletion-lease tests
lib/                         Shared GitHub API and Actions runtime helpers
  test/                      Shared helper tests
tools/
  fleet-audit/               Local/private CLI, inventory discovery, docs, and tests
scripts/                     Build and repository validation utilities
  release/                   Version preparation, guarded publication, and tests
test/                        Integration checks for the published action packages
docs/
  getting-started.md          Walkthrough and adoption steps
  automation.md              What this repository runs itself
  releases.md                Semantic versioning, release PRs, and publication
  examples/                  Copyable workflows for consuming repositories
  legal/                     Bundled dependency license notices
README.md                    Starting point and links
LICENSE                      Repository license
CHANGELOG.md                 Reviewed notes for each shared action version
package.json                 One set of dependencies and development commands
package-lock.json            Locked dependency versions and integrity hashes
```

## How an action runs

A consumer references `lucasilverentand/actions/pr-policy@<full-commit-sha>`. GitHub reads `pr-policy/action.yml`, which points to `pr-policy/dist/index.mjs`. That committed bundle includes the code and its JavaScript dependencies, so the consumer needs no npm installation or checkout of their repository.

Maintainers edit `src/` and run the root build command. The build combines that source with shared `lib/` helpers and writes each action's bundle. Generated files are committed so GitHub can execute them directly; `.gitattributes` marks them as generated to reduce review clutter. They are still checked against a fresh build in CI.

The runtime bundle is a build artifact, not a second implementation to edit. Dependency notices live in `docs/legal/THIRD_PARTY_NOTICES` and ship with the repository.

## Dependency boundaries

The three actions share the GitHub API client and input/output helpers in `lib/`. Workflow YAML inspection belongs to `repository-audit/src/` because it is part of that action's policy. PR and branch policies remain in their own action folders.

The fleet tool imports the repository audit's source to reuse exactly the same checks. Its inventory discovery and command-line behavior live under `tools/fleet-audit/`; actions do not depend on that tool. Build and consistency checks in `scripts/` are development utilities.

Tests live beside the code they exercise. Root `test/` checks the packaged actions as consumers receive them, including loading the generated bundles from an isolated directory without `node_modules`.

One root package and lockfile cover the repository. Separate npm packages or workspaces would add release and installation steps without providing useful isolation for these small actions.

## Compatibility

The public action paths, inputs, outputs, and policy behavior remain stable through this reorganization. Each manifest's internal entry point moves with its action. Existing commit pins and the `v1.0.0` release continue to address the original immutable tree.

The fleet command's current source path is `tools/fleet-audit/index.mjs`; the old `scripts/audit-owner.mjs` path remains in older pinned versions. Adoption examples now live in `docs/examples/`. Those are source-tree navigation changes, not changes to the public action addresses.

## Private local files

`reports/` holds locally generated fleet findings and is ignored by Git. `node_modules/` is also ignored and recreated from the lockfile. Neither belongs in the public source tree. The shared configuration in this repository must remain generic; account inventories, credentials, internal endpoints, and deployment-specific exceptions belong in consuming repositories or private tooling.
