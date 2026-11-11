# Versioning and releases

All three actions share one semantic version. `package.json`, both root version fields in `package-lock.json`, and the newest `CHANGELOG.md` entry must agree. CI rejects mismatches, duplicate changelog versions, and missing release notes.

Use patch releases for compatible fixes, minor releases for compatible features, and major releases for breaking changes. A maintainer chooses the bump; publishing happens automatically after the reviewed version change merges and verification passes on main. The private npm package is development metadata; this workflow publishes GitHub Releases, not npm packages.

## Prepare a release

Merge the changes you want to release through ordinary PRs. Then start a release branch from an up-to-date main with no uncommitted changes:

```sh
git switch main
git pull --ff-only
git fetch --tags
git switch -c release/next
npm run release:prepare -- patch
```

Replace `patch` with `minor` or `major` when appropriate. The command increments the version, updates both package files, and adds a dated changelog entry using commit subjects since the current version tag. It creates no commit, tag, or GitHub release. Review the generated notes for clarity and group them if useful.

Commit `package.json`, `package-lock.json`, and `CHANGELOG.md` together and open a PR with the usual Summary and Testing sections. Run `npm test` and `npm run check` before pushing. Merge after the required checks pass.

## Publish

The Publish release job is part of [CI](../.github/workflows/ci.yml). It depends on successful verification and runs only on main pushes or a manual CI dispatch on main. PR runs cannot publish. Only this job receives Contents write permission through GitHub's short-lived repository token. It needs no stored credential and cannot approve or create PRs.

The publisher validates the version files and notes, checks that its verified commit is still the default-branch head, and rejects versions older than a published stable release. It creates `vMAJOR.MINOR.PATCH` at that exact SHA and publishes the matching changelog section as the release body. It does not update example pins or move any existing tag.

Pushes that retain an already-published version produce a no-op. Repeating a successful run does not alter the tag or release. If publication failed after tag creation, the same verified commit can resume publication when that tag points to it. A conflicting tag or a newer main commit stops the run rather than retagging code. Inspect the failed run before taking recovery action.

The main workflow's concurrency policy can cancel an older run when a newer main push arrives. Release publication also has its own concurrency group. If a run was interrupted, dispatch CI on the current main; if an unpublished tag belongs to an older commit, inspect that verified commit and finish its release deliberately. Never move a version tag to repair a failed run.

## Consume a release

Use the full commit SHA behind a reviewed release:

```yaml
- uses: lucasilverentand/actions/pr-policy@<reviewed-release-commit>
```

The same SHA versions all three action folders. Existing pins and releases remain valid. Release tags are protected against update and deletion; moving `v1` aliases are intentionally not part of this workflow.

`v1.0.0` and `v1.0.1` were published before this automation was introduced. Their existing tags and releases are preserved, and their history is recorded in the changelog. `v1.1.0` introduces the automated publication workflow.

## Implementation

`scripts/release/metadata.mjs` validates versions and extracts notes. `prepare.mjs` prepares local version changes; `publish.mjs` handles guarded API publication. Tests under `scripts/release/test/` cover metadata rejection, preparation in a real temporary Git repository, repeat runs, permission failures, tag conflicts, and branch advances.
