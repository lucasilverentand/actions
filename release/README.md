# Semantic release

Preview or publish a stable semantic version from unreleased Conventional Commits. This action is maintained for this repository's own releases and for simple single-version repositories. Repositories with an existing release-please setup should keep it. It reads GitHub's API and needs no checkout, npm installation or local Git.

Only `push` and `workflow_dispatch` runs on the current default branch are accepted. Fork, archived and disabled repositories are excluded. If the default branch has already moved to a newer descendant of `GITHUB_SHA`, the run succeeds as `superseded` without planning or writing anything; the newer run releases both commits. Rewritten or unrelated history still fails. Use a separate release job that depends on verification, with a non-cancelling concurrency group.

Preview is the default. Publishing requires `dry-run: 'false'`, Contents write, and a nonempty `needs: ${{ toJSON(needs) }}` object containing only successful jobs. Include all required verification jobs in that dependency list. Inputs are not an independent lookup of GitHub status checks; protect the calling workflow and use branch rules.

The planner takes the highest stable `vMAJOR.MINOR.PATCH` release, verifies complete non-divergent history, and selects the largest change: breaking header/footer means major, `feat` means minor, other supported Conventional Commit types mean patch. With no stable releases, `initial-version` is used. Already released commits are a no-op.

Published tags and releases are immutable. Conflicting tags, diverged heads and version rollback are rejected. A retry can complete an interrupted publication when the existing tag matches exactly. Tag creation and release publication are separate API operations; a network failure can leave a tag for the next run to resume. Branch advancement can still occur after the final check, so serialize callers and protect release tags.

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | `${{ github.token }}` | Contents read for preview, write for publication |
| `dry-run` | `true` | Set false explicitly to publish |
| `needs` | `{}` | Upstream verification results; mandatory when publishing |
| `initial-version` | `1.0.0` | First stable version when no stable releases exist |

Outputs: `planned`, `created`, `superseded` (booleans), `version`, `tag`, `notes`, `url` (ordinary strings). No-change and superseded runs return empty strings. Notes include commit subjects; private repositories must preserve their access boundary around these outputs.

Use [the adoption example](../docs/examples/release.yml). This action targets one stable release stream with `v` tags. Package publishing, monorepo versions, prereleases, signing, deployment and rollback stay in their owning workflows. It does not automatically replace an existing Release Please manifest strategy.

For adoption into an existing project without a stable published release, the first plan checks the entire reachable history. All those subjects must satisfy the supported Conventional Commit syntax. Otherwise, first establish a reviewed stable GitHub Release at the intended migration baseline; a bare tag is not enough. `initial-version` selects the first version and does not skip historical validation.
