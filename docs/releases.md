# Automatic versioning and releases

Merge an ordinary PR with a Conventional Commit title. After verification succeeds on main, CI calculates the next semantic version and publishes its tag and GitHub Release. There is no local release command, version-file update, or separate release PR.

All actions share the same version. Published stable GitHub Releases are the version source of truth. This repository's npm package is private development metadata and deliberately has no release version; it is never published to npm.

## How versions are chosen

The publisher reads all commits between the highest published stable version and the verified main commit. Squash merging preserves the validated PR title and the reviewed PR body as the commit message.

| Merged commit | Automatic bump |
| --- | --- |
| `feat: ...` or `feat(scope): ...` | Minor, such as 1.2.3 → 1.3.0 |
| Any type with `!`, such as `fix(api)!: ...` | Major, such as 1.2.3 → 2.0.0 |
| A `BREAKING CHANGE:` or `BREAKING-CHANGE:` footer | Major |
| Other Conventional Commits, including fixes, docs, dependencies, and CI changes | Patch, such as 1.2.3 → 1.2.4 |

The largest bump wins when several commits are pending. If an older CI run is canceled by a newer push, the next successful run includes all commits since the last published release. A repository with no stable releases starts at v1.0.0.

Unclassified commit titles, divergent history, missing pages, and duplicate commit records stop planning rather than silently choosing a version. Normal PR policy and squash-only merging keep the expected commit format in place. Breaking changes should be explicitly marked before merging.

## What CI publishes

The Publish release job in [CI](../.github/workflows/ci.yml) depends on Verify. It runs only on main pushes or a manual CI dispatch on main. PR runs cannot publish. Only that job receives Contents write permission through GitHub's short-lived repository token. It needs no stored credential or permission to create or approve PRs.

The publisher creates `vMAJOR.MINOR.PATCH` at the exact verified main SHA and generates notes from the merged commit titles, with their short SHAs. It does not commit version files, update main, or move existing tags. Full notes and the current version appear on the [GitHub Releases page](https://github.com/seventwo-studio/actions/releases).

Rerunning an already-released main commit finds no new commits and does nothing. Tag pushes do not trigger the main-branch workflow, so release publication cannot create a loop.

## Failure and recovery

The publisher checks that the verified SHA is still the default-branch head before publishing and again before its first write. It rejects conflicting tags and versions older than an existing stable release. Protected tags are never moved.

If publication failed after tag creation, the same verified commit can resume publication when that tag points to it. If main advanced in the meantime, inspect the failed run and tag before completing the interrupted release. Never retag code to repair a failure. A CI dispatch on current main retries version planning and publishing entirely in GitHub; it requires no local preparation.

The publisher serializes release jobs, while the main workflow can cancel older runs when a newer push arrives. A narrow concurrent update can still stop a run safely. Any pending changes remain in the comparison with the last published release.

## Consume a release

Use the full commit SHA behind a reviewed release:

```yaml
- uses: seventwo-studio/actions/workflow-policy@<reviewed-release-commit>
```

The same SHA versions all action folders. Existing pins and releases remain valid. Release tags are protected against update and deletion; moving `v1` aliases are intentionally not part of this workflow.

The earlier v1.0.0, v1.0.1, and v1.1.0 releases are preserved. The [changelog](../CHANGELOG.md) retains their history and links to automatically generated release notes.

## Implementation

`scripts/release/metadata.mjs` classifies Conventional Commits and performs semantic version arithmetic. `plan.mjs` discovers published versions, paginates unreleased commits, and generates the next version and notes. `publish.mjs` handles guarded, idempotent API publication. Tests under `scripts/release/test/` cover classification, pagination, first releases, repeat runs, failures, tag conflicts, and exact-commit publication.

## Reuse from another repository

The [release action](../release/README.md) packages the same planner and publisher with preview mode, upstream-job validation and a configurable initial stable version. It needs no checkout. Repository-specific package publication, deployment, signing and release acceptance remain separate.
