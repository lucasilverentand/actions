# Workflow policy

Catch unsafe workflow changes while reviewing a PR. This action reads workflow YAML through GitHub's API and applies the same checks as [repository audit](../repository-audit/). It does not check out or execute the inspected repository.

On `pull_request` or `pull_request_target`, it inspects added and changed `.github/workflows/*.yml` and `.yaml` files at the PR's exact head commit. It resolves the merge base using the immutable base and head commits, then compares complete workflow directories at the merge base and head by their blob SHAs. It never uses the mutable PR changed-file endpoint or the comparison endpoint's capped file list. This keeps the inspected file set consistent even if a branch changes and changes back during inspection.

The live PR must match the event head; the action rechecks head and base after inspection. A stale event, concurrent update, incomplete directory, inaccessible file, or malformed YAML fails as unverified. Removed or renamed-out workflows are reported as warnings so reviewers can check replacement coverage.

On `schedule` or `workflow_dispatch`, it resolves the current default branch to a commit and inspects all its workflow files. It accepts neither a user-supplied repository URL nor download URLs from PR metadata.

## Installation

Copy the [example workflow](../docs/examples/workflow-policy.yml), replacing the implementation placeholder with the full commit SHA of a reviewed release that contains this action. Use an immutable published action reference and no checkout. Add the workflow's check to your required status checks after a successful initial run. The check name and required-check configuration belong to the consuming repository.

The ordinary `pull_request` event is sufficient for repositories where the workflow check itself is protected by review. `pull_request_target` keeps the caller workflow on the trusted base branch, including fork PRs; use it only with the pinned action, read-only permissions, and no untrusted checkout or script execution. PR-controlled changes to an ordinary `pull_request` caller can change that caller; this action alone cannot enforce its own installation.

## Checks

The shared inspector requires literal commit pins for external actions and reusable workflows, digest pins for action/job/service containers, explicit token permissions, explicit job timeouts with no fixed maximum, checkout without persisted credentials, and explicit secrets for reusable workflows. It rejects direct event/input expression interpolation into scripts, checkout on privileged triggers, malformed workflow structures, duplicate YAML keys, unsupported tags, and excessive aliases.

Persistent self-hosted runners in PR workflows need a narrowly recognized job condition excluding forks: `github.event.pull_request.head.repo.full_name == github.repository`. For workflows without `pull_request_target`, `github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository` is also accepted. More complex expressions remain flagged for review. Same-repository PR authors must be trusted with the runner; the linter does not prove expression safety or runner isolation and cannot resolve dynamic/custom runner labels.

## Interface

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | `${{ github.token }}` | Contents read and Pull requests read |
| `fail-on-error` | `true` | Fail for errors or incomplete inspection; `false` only changes exit status |

Outputs are `findings` (JSON array), `passed` (JSON boolean), `inspected-sha` (commit SHA or null), and `inspected-count` (number of files in the completed inspection batch). Findings also appear in the job summary. Up to four files are read concurrently; findings retain directory order. A file-read failure invalidates the batch instead of publishing partial workflow findings. Workflow directories of 1,000 or more entries, duplicate or malformed directory metadata, and workflow symlinks are rejected rather than treated as complete. Unrelated changed files do not impose a PR-size limit. Individual files use the shared API client's 1 MB limit.

This is static workflow linting. It does not inspect scripts invoked by a workflow, recursively analyze referenced actions, or verify application security.
