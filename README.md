# actions

Reusable GitHub Actions for PR quality, repository configuration checks, and conservative branch maintenance. Policies and implementation are public; credentials, private inventories, and audit results stay with the repositories being checked.

| Action | Behavior | Permissions |
| --- | --- | --- |
| [`pr-policy`](pr-policy/action.yml) | Checks Conventional Commit titles and meaningful body sections | None |
| [`repository-audit`](repository-audit/action.yml) | Reads repository settings and workflow configuration | Contents read; Administration and vulnerability alerts read for a complete audit |
| [`branch-cleanup`](branch-cleanup/action.yml) | Previews old merged branches; deletion requires an explicit opt-in | Contents and Pull requests read; Contents write for deletion |

These actions support GitHub.com and use the Node.js 24 action runtime. Consumers do not need to install dependencies or check out their code. Each action operates on the repository running the workflow.

## Adopt the actions

Copy the workflows from [`examples/`](examples/) into a consuming repository's `.github/workflows/` directory. The examples pin a reviewed implementation commit. Keep full commit pins and review source changes before updating them. Published version tags are immutable.

The PR policy workflow uses `pull_request`, including `edited` so title and body edits are checked. It runs without write access, secrets, or checkout. Add its check to the default branch's required status checks after the first successful run. Configure squash commits to use the PR title and body, so the validated text becomes the commit message.

The audit workflow runs nightly and can be dispatched manually. Its full inspection needs a repository-scoped credential in `REPOSITORY_AUDIT_TOKEN`. Prefer a GitHub App installation token with Contents read, Administration read, and vulnerability alerts read. A fine-grained personal access token limited to selected repositories is another option. The built-in `GITHUB_TOKEN` cannot inspect all administrative settings; unavailable checks are reported as **unverified errors**, never silently passed. Use `fail-on-error: 'false'` for an initial report-only rollout.

The branch workflow starts in dry-run mode with a read-only token. Review its candidates before changing `dry-run` to `'false'` and granting that job `contents: write`. Do not run cleanup on PR events or from a non-default branch. Use a separate concurrency group for cleanup, as in the example.

Installing this library does not automatically enroll other repositories or change their settings.

## PR policy

Titles use `type(optional-scope)!: description`, with a maximum of 100 Unicode code points by default. Allowed types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. Examples:

```text
fix(parser): handle empty documents
feat!: simplify the configuration format
docs: clarify setup instructions
```

Bodies need `## Summary` and `## Testing` sections, each with at least 12 characters of meaningful content. Headings are case-insensitive. Comments, empty sections, and placeholder-only answers do not satisfy the check. Explain tests that were skipped, for example: “Not run: documentation-only changes.” This is a structural check; human review still assesses whether the explanation is accurate and useful. There are no bot exemptions.

## Repository audit

The default policy checks:

- Squash-only merges, PR title/body squash messages, and automatic merged-branch deletion.
- Default-branch pull request requirements, required status checks, force-push and deletion protection, and resolved review conversations, using active rulesets and classic protection.
- Read-only default workflow tokens, disabled workflow PR approval, and dependency vulnerability alerts.
- Secret scanning and push protection when inspectable; README, security policy, public license, and dependency update configuration.
- Full SHA pins for external actions and reusable workflows; digests for container actions; explicit token permissions; job timeouts; checkout without persisted credentials; direct event/input interpolation into shell or GitHub scripts; privileged-event checkouts; and obvious self-hosted PR runners.

Missing documentation and unavailable feature metadata are warnings. Configuration violations and failed inspections are errors. Findings appear in the consuming job's summary and the `findings` output as JSON. `fail-on-error` defaults to `'true'`.

Workflow files are read from the default branch and parsed as data. This audit does not execute repository code, scan application vulnerabilities, follow the internals of every dependency, or prove that an arbitrary workflow is safe. Inherited community files and externally configured update bots may need separate verification. Approval counts, deployment environments, organization bypass policies, and language-specific CI remain repository decisions.

## Branch cleanup

A branch is eligible only when its exact current tip matches the head SHA of a merged PR into the current default branch. Both the merge and the commit's author and committer dates must be at least 30 days old by default. Exact-head matching supports squash and rebase merges without treating an unmerged newer tip as disposable.

Cleanup retains default and long-lived branches (`main`, `master`, `trunk`, `dev`, `develop`, `development`, `staging`, `production`, `gh-pages`), `release/`, `releases/`, and `hotfix/` prefixes, protected branches, branches with any active rules, and branches used as a head or base of an open PR. Add more retained prefixes with `keep-prefixes: '["support/", "stable/"]'`. Archived, disabled, and fork repositories are excluded.

Before each deletion the action rechecks repository state, the branch tip, rules, merge evidence, and open PRs. Git deletion uses `--force-with-lease` with the inspected SHA, which rejects concurrent tip changes. If more than `max-deletions` candidates are found (10 by default), the run aborts before deleting anything. API failures stop the run. Keep essential branches protected: the open-PR check and deletion cannot be performed in a single GitHub transaction. See [SECURITY.md](SECURITY.md).

## Audit all owned repositories

The local fleet command discovers the authenticated personal account's active, non-fork repositories, including private repositories accessible to its token. It makes read-only API calls and saves findings to `reports/audit.json`, which Git ignores. Run it locally or from a **private** controller repository, never in this public repository's workflows.

```sh
npm ci --ignore-scripts
node scripts/audit-owner.mjs
```

It uses `GH_TOKEN`, then `GITHUB_TOKEN`, or the existing `gh` CLI authentication. The credential needs access to each repository and the audit permissions above. The command exits nonzero if errors or unverified inspections are found. Its console output contains totals; repository names and findings stay in the local report. Protect that file and keep it out of public artifacts.

For ongoing coverage, install the per-repository workflows across the repositories you maintain. For a central inventory, run the fleet command nightly in a private controller with a scoped App token and private report retention. No cross-repository credential belongs in `actions`.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run check
```

CI verifies tests, workflow policy, bundled-source consistency, and dependency advisories. Weekly dependency PRs keep npm and action pins current. This repository runs its own nightly audit and branch preview; the administrative audit is report-only until a scoped audit token is configured.

Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md). The code is [MIT licensed](LICENSE).
