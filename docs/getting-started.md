# Walkthrough and setup

This repository supplies eight actions that individual repositories can call, plus a standalone command for auditing multiple repositories. The workflows in `.github/workflows/` maintain this library itself. The files in `docs/examples/` are templates to install elsewhere.

## 1. Check PR descriptions

[PR policy](../pr-policy/) runs when a pull request is opened or changed. It reads the title and body from the event payload, checks the title format and required sections, and fails with guidance if they do not match the policy.

The default title format is a Conventional Commit such as `fix(parser): handle empty input`, up to 100 characters with a 72-character summary. Scope restrictions and visible issue-key linkage are configurable. Bodies need Summary and Testing sections with useful text. This keeps merge history and review descriptions consistent. It does not run the described tests or judge the technical correctness of the change.

Copy [pr-policy.yml](examples/pr-policy.yml) into the consuming repository's `.github/workflows/`. It needs no checkout, token permissions, or secrets. After its first successful run, add the check to default-branch protection. If squash commits should preserve this text, configure their title and message to use the PR title and body.

## 2. Audit repository configuration

[Repository audit](../repository-audit/) checks settings and default-branch workflow files through GitHub's API. It looks for merge-setting drift, missing branch safeguards, broad workflow permissions, floating action dependencies, and several risky workflow patterns. It also checks for documentation and update-bot configuration.

The result is a job summary and JSON findings. It reports what needs attention; it does not change settings, execute the inspected code, or scan an application's vulnerabilities. Some rules express preferences, including squash-only history. Other rules address safety, such as rejecting direct PR text interpolation into shell scripts.

Copy [repository-audit.yml](examples/repository-audit.yml). A complete audit needs a scoped read credential in `REPOSITORY_AUDIT_TOKEN`. Use a short-lived GitHub App installation token where practical, or a fine-grained personal access token restricted to the relevant repositories. See the action's [permissions reference](../repository-audit/README.md#permissions).

Start with `fail-on-error: 'false'` to collect a baseline. Missing access remains an unverified error in the report even when the workflow is report-only. Enable enforcement when the credential and baseline are ready. Keep findings about a private repository inside that repository or a private controller.

## 3. Preview old merged branches

[Branch cleanup](../branch-cleanup/) handles branches that remain after a merge. By default it only lists candidates. The exact current tip must match a merged PR into the default branch, and both the merge and commit dates must be at least 30 days old. Protected, long-lived, release, and active-PR branches are retained.

Copy [branch-cleanup.yml](examples/branch-cleanup.yml) and review previews. Deletion requires both `dry-run: 'false'` and Contents write permission for that job. The default limit is 10 candidates; larger batches abort before deleting anything. New commits at a branch tip cause the expected-SHA deletion lease to reject removal.

This complements GitHub's ordinary automatic deletion after merge. It does not remove unmerged work simply because a branch is old. Keep essential branches protected, since checking open PRs and deleting a branch cannot happen in one atomic API operation.

## 4. Audit a personal account or organization

The [fleet audit tool](../tools/fleet-audit/) discovers accessible, active, owned repositories and calls the same read-only audit for each one. It writes `reports/audit.json` locally, with restrictive file permissions. Git ignores that report.

Run it locally or in a private controller. It refuses to run in a public GitHub Actions repository. Omit scope options to inspect the authenticated personal account, or pass `--org seventwo-studio` to inspect that organization. Personal credentials list repositories accessible in the selected scope; App installation tokens are limited to the selected repositories in their installation. Neither can discover repositories outside its access.

This command gives an inventory at the time it runs. For recurring per-repository enforcement, install the caller workflows in each repository. For recurring central reporting, schedule the command in a private controller and retain its reports privately. Creating or cloning this public library does not enroll the rest of an account.

## Additional checks and releases

[Workflow policy](../workflow-policy/) checks proposed workflow changes using immutable API content. Its trusted-base example needs no checkout of PR code. Require its check to catch configuration problems before merge.

[Commit policy](../commit-policy/) checks actual messages in immutable commit ranges. For squash workflows, run it on pushes to the default branch and validate PR titles separately; enable PR commit checks when intermediate commits must also follow policy.

[CI gate](../ci-gate/) provides one required check for upstream suites. Include all suites in its needs list and use always() so failures and skipped jobs reach the gate. Its receipt can be retained as an artifact.

[Release](../release/) previews semantic versions from unreleased commits. Publication needs explicit activation, Contents write, successful upstream jobs and a non-cancelling concurrency group. Keep deployment and package publishing in their owning workflows.

[Fleet audit](../fleet-audit/) runs the existing inventory in a private scheduled controller and retains a private report. Both audits and cleanup use bounded parallel reads; deletion remains serial.

All actions support compatible hosted and self-hosted runners; see [runner compatibility](runner-compatibility.md).

## What this library runs itself

The [automation guide](automation.md) describes CI, nightly audit and preview jobs, dependency updates, PR templates, and ownership files. Branch protection and release-tag rules are GitHub settings; the workflow templates do not automatically install those settings elsewhere.

The [repository map](architecture.md) shows where each implementation and test lives.
