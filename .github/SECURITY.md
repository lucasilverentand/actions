# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/seventwo-studio/actions/security/advisories/new). Include the affected commit, expected behavior, and reproduction steps. Do not open a public issue containing credentials or an exploit against a live repository.

The latest release is supported. Consumers should pin reviewed release commits and review updates before adopting them.

## Trust boundaries

The pinned PR policy workflow reads PR titles and commit messages as data through the API with read-only PR access. It does not check out code or execute PR text.

The repository audit reads settings and default-branch workflow files through the API. It never executes those files or changes repository settings. Static checks cover the documented rules; they do not replace application security review or detect every way a workflow can invoke unsafe code.

Branch deletion requires an explicit opt-in and a token with Contents write access. Cleanup refuses PR events and non-default-branch runs. It retains protected branches, branches with active rules, long-lived branches, and branches participating in open PRs. It requires a stale merged PR whose head SHA exactly matches the current tip. Deletion uses Git's expected-SHA lease, so a concurrent branch update prevents deletion.

The API does not provide a transaction covering open PR checks and branch deletion. A PR can be opened after the final check. Use protection rules or an excluded prefix for branches that must always be retained. A run can partially complete before an API or network failure; the next preview will show the remaining candidates.

## Credentials and reports

Use repository-scoped GitHub App tokens where possible. Administrative audits need read access to settings unavailable to `GITHUB_TOKEN`. Keep those credentials in the consuming repository or a private controller. Do not give this public repository access to private repositories.

The public source contains generic policy and code. Private repository inventories, audit findings, credentials, internal endpoints, and operational exceptions belong elsewhere. Fleet reports are ignored by Git and are written locally with restrictive permissions. Do not upload them to public workflow logs, issues, summaries, or artifacts.

Action dependencies are bundled. Committed bundles must match the source build. CI checks this and audits the lockfile for known dependency advisories. Actions used by workflows are pinned to full commit SHAs; dependency updates still require review.

## Additional action boundaries

Workflow policy inspects immutable PR content without executing it. The CI gate retains only dependency result states, not upstream outputs. Its caller owns the complete dependency list.

Release publication defaults to preview and requires a trusted default-branch event, successful upstream results and explicit write activation. Tags never move. Fleet actions require a private controller before discovery and again before exposing their report path; keep artifacts private and bounded in retention. Windows runners must protect private temporary directories using account ACLs; POSIX modes alone do not establish Windows access control.
