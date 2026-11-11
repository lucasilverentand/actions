# Commit policy

Check actual commit messages in the immutable SHA range of a push or pull request. This action uses read-only GitHub API requests; it needs no checkout and never executes commit or PR content.

For a squash-only workflow, use [PR policy](../pr-policy/) before merge and run this action on pushes to the default branch. That checks the resulting history while permitting intermediate work-in-progress commits on feature branches. Add `pull_request` only when every feature commit must already follow the policy. Copy the [push example](../docs/examples/commit-policy.yml).

## Message policy

Subjects use `type(optional-scope)!: summary`. Allowed lowercase types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. The complete subject and the summary default to at most 100 Unicode code points; set `max-summary-length: '72'` for the conventional Git summary limit. Empty summaries, surrounding whitespace, line separators, control characters, and directional overrides fail.

Set `allow-scopes: 'false'` when the repository requires subjects such as `fix: handle empty input`. A nonempty body must follow a blank line. Breaking-change markers and footers are accepted. Commit signatures are not required or evaluated.

```text
feat!: simplify the configuration format

BREAKING CHANGE: replace the legacy settings key with configuration.
```

## Event and inspection boundaries

The supported events are `pull_request` and branch `push`. Comparisons use the event's full base and head SHAs, so moving branch names do not change the inspected range. Fork PR comparisons use commits in the base repository's network. Grant Contents read. The action rejects `pull_request_target`, manual events, tag pushes, and repository mismatches.

Newly created branches have no previous commit SHA and fail with an unsupported-range error. Use `pull_request` for feature branches and restrict push triggers to an established default branch. Deleted branches contain no new commit messages and report zero inspected commits.

The action paginates the [GitHub comparison API](https://docs.github.com/en/rest/commits/commits#compare-two-commits), checks reported totals, and rejects incomplete pages, duplicate commits, missing messages, and a missing requested head. A range above `max-commits` fails instead of silently checking a subset. API errors fail the run. It inspects commit metadata and does not prove that the code passed CI or review. A push check reports a commit that has already reached its branch; use PR protection to govern merging.

## Interface

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | `${{ github.token }}` | Repository credential with Contents read |
| `max-summary-length` | `100` | Maximum Unicode code points after type/scope; 1–200 |
| `max-subject-length` | `100` | Maximum complete subject; 40–200 |
| `allow-scopes` | `true` | Permit optional Conventional Commit scopes |
| `max-commits` | `250` | Maximum complete comparison size; 1–1000 |

The `valid` output is a JSON boolean. `checked-count` is the number of inspected messages. `findings` is a JSON array of commit SHAs and fixed policy diagnostics; untrusted commit text is not copied into logs or summaries. Policy violations fail the step. Inspection errors fail before producing a passing result.

## Files

`action.yml` declares the interface. `src/index.mjs` selects immutable ranges and validates complete API results. `../lib/commit-policy.mjs` shares Conventional Commit validation with PR policy. `test/` covers policy failures, immutable event selection, pagination, and incomplete inspections. The generated `dist/index.mjs` runs without a consumer checkout or npm installation.
