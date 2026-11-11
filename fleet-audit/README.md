# Private fleet audit

Run the repository audit across accessible, active repositories in one personal or organization scope. This action is the scheduled counterpart of the [fleet CLI](../tools/fleet-audit/). Both use the same discovery and audit implementation.

The action runs only on `schedule` or `workflow_dispatch`, from the controller's current default branch. It verifies through GitHub's API that the controller is private before discovering any repositories and rechecks before writing the report. Public controllers, PR events, non-default branches, and unverified controller visibility fail before an inventory is collected. Keep the controller private throughout report retention.

Supply a scoped read credential that can inspect the private controller and the repositories in the requested scope. Each audited repository needs Contents read, Administration read, and vulnerability alerts read for a complete result. A GitHub App installation credential sees only repositories selected for that installation. A personal credential sees the repositories accessible to it. Neither proves coverage outside its access.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | Required | Read credential covering the controller and audited repositories |
| `organization` | Empty | Explicit organization login; empty selects personal repositories |
| `fail-on-error` | `true` | Fail for errors and unverified inspections; `false` allows report-only adoption |
| `inspection-concurrency` | `2` | Concurrent repository inspections, from 1–4 |

Archived, disabled, and fork repositories are excluded. Inventory failures stop the run instead of reporting a successful partial fleet. Individual repository inspection failures remain error findings so the remaining repositories can still be reported.

## Results and retention

`report-path` is an absolute path to a JSON report in a unique directory under the runner's temporary directory. On POSIX hosts, the directory uses mode `0700` and the file mode `0600`. Windows relies on the runner account's temporary-directory ACLs; use an isolated runner account whose temporary files are inaccessible to other users. Findings and repository names stay in that file; logs and job summaries contain totals only.

The `repository-count` and `error-count` outputs are numbers. `passed` is a JSON boolean and remains false for error findings even when `fail-on-error` is false. The report includes its generation time, selected scope, and each inspected repository's findings.

Copy the [example workflow](../docs/examples/fleet-audit.yml) into a private controller. It retains completed reports as private artifacts for seven days, including reports with audit errors. The upload step checks that `report-path` exists before attempting retention. Never forward the report to public logs, summaries, issues, or artifacts.

This action reports configuration drift. It does not change settings, enroll repositories, or execute inspected repository code. The [repository audit reference](../repository-audit/) describes the checks and their limits.
