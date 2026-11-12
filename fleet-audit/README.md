# Private fleet audit

Run the repository audit across accessible, active repositories in one personal or organization scope. This action is the scheduled counterpart of the [fleet CLI](../tools/fleet-audit/). Both use the same discovery and audit implementation.

The action runs only on `schedule` or `workflow_dispatch`, from the controller's current default branch. It verifies through GitHub's API that the controller is private before discovering any repositories and rechecks before writing the report. Public controllers, PR events, non-default branches, and unverified controller visibility fail before an inventory is collected. Keep the controller private throughout report retention.

Supply a scoped read credential that can inspect the private controller and the repositories in the requested scope. Each audited repository needs Contents read, Administration read, and vulnerability alerts read for a complete result. A GitHub App installation credential sees only repositories selected for that installation. A personal credential sees the repositories accessible to it. Neither proves coverage outside its access.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `rules` | `{}` | JSON object mapping rule ids to error, warning or off. Unverified inspections cannot be changed. |
| `trusted-owners` | `[]` | JSON array of owners whose actions and reusable workflows may be referenced by branch or tag. |
| `token` | Required | Read credential covering the controller and audited repositories |
| `organization` | Empty | Explicit organization login; empty selects personal repositories |
| `fail-on-error` | `true` | Fail for errors and unverified inspections; `false` allows report-only adoption |
| `inspection-concurrency` | `2` | Concurrent repository inspections, from 1–4 |

Archived, disabled, and fork repositories are excluded. Inventory failures stop the run instead of reporting a successful partial fleet. Individual repository inspection failures remain error findings so the remaining repositories can still be reported.

## Tuning rules

Rule IDs: `actions-approval`, `actions-permissions`, `admin-bypass`, `block-branch-deletion`, `block-force-push`, `branch-protection`, `default-branch-head`, `default-token`, `delete-merged-branches`, `dependency-updates`, `description`, `inspection`, `license`, `merge-method`, `readme`, `repository-files`, `require-checks`, `require-pull-request`, `required-check`, `resolve-conversations`, `secret-scanning`, `secret-scanning-push-protection`, `security-policy`, `squash-message`, `vulnerability-alerts`, `workflow-audit`, `workflow-checkout-credentials`, `workflow-container-pin`, `workflow-injection`, `workflow-parse`, `workflow-permissions`, `workflow-pin`, `workflow-privileged-checkout`, `workflow-runner`, `workflow-secrets`, `workflow-timeout`, `workflow-write-all`, `workflows`.

For example:

```yaml
rules: '{"workflow-timeout": "warning", "description": "off"}'
trusted-owners: '["example-org"]'
```

Unverified inspections always stay errors.

## Results and retention

`report-path` is an absolute path to a JSON report in a unique directory under the runner's temporary directory. On POSIX hosts, the directory uses mode `0700` and the file mode `0600`. Windows relies on the runner account's temporary-directory ACLs; use an isolated runner account whose temporary files are inaccessible to other users. Logs contain totals only. After the second private-controller check, the job summary lists each repository that needs attention with its findings, errors first, capped at 300 lines; the file holds the complete report. The summary follows the controller's run-log retention and access, not the artifact's.

The `repository-count` and `error-count` outputs are numbers. `passed` is a JSON boolean and remains false for error findings even when `fail-on-error` is false. The report includes its generation time, selected scope, and each inspected repository's findings.

Copy the [example workflow](../docs/examples/fleet-audit.yml) into a private controller. It retains completed reports as private artifacts for seven days, including reports with audit errors. The upload step checks that `report-path` exists before attempting retention. Never forward the report to public logs, summaries, issues, or artifacts.

This action reports configuration drift. It does not change settings, enroll repositories, or execute inspected repository code. The [repository audit reference](../repository-audit/) describes the checks and their limits.
