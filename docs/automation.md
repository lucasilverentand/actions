# Automation in this repository

The workflows in `.github/workflows/` maintain this library. The templates in [examples/](examples/) install checks into other repositories. An action provides a capability; a caller workflow supplies the trigger, credential, and permission scope.

## CI

[ci.yml](../.github/workflows/ci.yml) runs on pushes to main, PR changes including title/body edits, and manual dispatch. Its Linux, macOS and Windows test jobs install the locked dependencies without lifecycle scripts, run tests, rebuild all action bundles, check that committed bundles match, validate workflow policy and manifests, and check dependency advisories at moderate severity or higher.

The aggregate Verify job uses ci-gate and fails unless the whole matrix succeeds. A manually dispatched [runner compatibility workflow](../.github/workflows/runner-compatibility.yml) accepts a JSON runner selector, including self-hosted groups and labels. It runs only from the default branch and exercises the suite without remote deletion or publication. The selected pool must already be admitted to this repository.

The PR policy job uses a pinned, published implementation with no token permissions or checkout. This checks the PR's title and body independently of changes to the candidate source. The Verify and PR policy jobs are required checks on this repository's main branch.

After Verify succeeds on main, the Publish release job uses the bundled release action, passes actual upstream job results, and computes the next version from unreleased Conventional Commits, creates its tag at the verified SHA, and publishes generated notes on GitHub. It uses only a repository-scoped workflow token. PR runs cannot publish, no version files or release PRs are created, and an already-released commit is a no-op. See the [release guide](releases.md).

Tests verify the implemented behavior, including rejection cases and branch-tip races. Dependency advisory checks cover known advisories in installed packages. Neither is a complete security review of an arbitrary change.

## Nightly maintenance

[maintenance.yml](../.github/workflows/maintenance.yml) runs at 03:23 UTC daily and by manual dispatch. A concurrency group prevents overlapping runs.

The audit job checks this repository's configuration and workflow files. It uses `REPOSITORY_AUDIT_TOKEN` if configured, otherwise the built-in workflow token. Without the administrative read credential, it runs in report-only mode and records inaccessible inspections as unverified errors.

The branch-preview job uses Contents read and Pull requests read permissions. It always sets `dry-run: 'true'`. It cannot delete branches with those permissions and does not audit or clean other repositories.

## Dependency and contribution files

[dependabot.yml](../.github/dependabot.yml) requests weekly updates for npm dependencies and GitHub Actions. An npm update that affects a bundled dependency also needs regenerated bundles; the consistency check catches a source/bundle mismatch.

[pull_request_template.md](../.github/pull_request_template.md) supplies Summary and Testing prompts. The template helps authors fill in a body; the PR action validates the resulting text.

[CODEOWNERS](../.github/CODEOWNERS) identifies who owns changes. Review requirements still depend on GitHub's branch settings. The [contribution guide](../.github/CONTRIBUTING.md) explains development, and the [security policy](../.github/SECURITY.md) explains private reporting and trust boundaries.

## Repository settings

This repository's main branch requires PRs, the two named checks, resolved conversations, and up-to-date branches. Force pushes and deletion are blocked, including for administrators. Squash commits use the PR title and body, and merged PR branches are deleted automatically.

Release tags matching `v*` and `implementation-v*` have active rules blocking updates and deletion. Version tags are not moved when new code is published. Consumers should keep reviewed full commit pins and update them deliberately.

These settings live in GitHub, outside the file tree. Reusing an action or copying a workflow does not copy branch protection, release rules, or credentials into another repository.
