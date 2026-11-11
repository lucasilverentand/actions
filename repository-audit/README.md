# Repository audit

Read repository settings and default-branch workflow files, then report departures from the baseline. The action makes read-only GitHub API requests. It never executes the inspected code or changes settings.

Copy the [example workflow](../docs/examples/repository-audit.yml) for nightly and manual runs. The action checks the repository running that workflow. The separate [fleet tool](../tools/fleet-audit/) reuses this implementation to check multiple repositories.

## Checks

| Area | Baseline |
| --- | --- |
| Merge settings | Squash-only merges; PR title and body become the commit message; merged branches are deleted automatically |
| Default branch | Require PRs and CI checks; block force pushes and deletion; resolve review conversations |
| Workflow defaults | Read-only tokens; workflows cannot create and approve PRs by default |
| Security features | Dependency vulnerability alerts; secret scanning and push protection when inspectable |
| Repository files | README, security reporting policy, public license, and dependency update configuration |
| Workflow files | Immutable external action pins and container digests; explicit permissions; job timeouts; checkout without persisted credentials; direct event/input interpolation into scripts; privileged-event checkout; obvious self-hosted PR runners; inherited reusable-workflow secrets |

Squash-only merging is a history preference in this baseline. It is not a prerequisite for a secure repository. Approval counts, deployment environments, organization bypass policies, and language-specific CI remain repository decisions.

Missing documentation and unavailable security-feature metadata are warnings. Configuration violations and failed inspections are errors. If a token cannot inspect a setting, the action marks the check unverified rather than passing it.

Repository files and workflow files are read from one resolved default-branch commit, so a push cannot mix revisions within an inspection. Use [workflow policy](../workflow-policy/) to inspect proposed workflow changes before merge. This is configuration linting, not an application vulnerability scan, a secret search through source history, or proof that every dependency is safe. Inherited community files and externally configured update bots may need separate verification.

Required-check rules must contain actual check names; an empty ruleset does not satisfy the baseline. Set `required-checks` to the exact names your repository requires when you also want to detect missing individual checks. The audit combines classic protection and active rulesets; it does not prove that required checks ran or that organization bypass policies are appropriate.

Workflow linting also checks job/service container digests, permission-map structure, malformed steps, and bracket-notation event/input interpolation. Self-hosted PR jobs may use the narrowly recognized same-repository guards documented in [workflow policy](../workflow-policy/); more complex guards remain flagged for review.

## Permissions

A full audit needs a repository-scoped credential with Contents read, Administration read, and vulnerability alerts read. Prefer a short-lived GitHub App installation token; a fine-grained personal access token limited to selected repositories is another option. Supply it as `REPOSITORY_AUDIT_TOKEN` in the consuming repository.

The built-in `GITHUB_TOKEN` cannot inspect every administrative setting. It can provide a partial report, with inaccessible checks recorded as unverified errors. Use `fail-on-error: 'false'` for report-only adoption. Keep private findings in the consuming repository or a private controller.

## Interface

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | `${{ github.token }}` | GitHub credential used only for read requests |
| `fail-on-error` | `true` | Fail the step if errors or unverified checks are found |
| `required-checks` | `[]` | JSON array of exact required CI check names, such as `["Verify", "PR policy"]` |

| Output | Meaning |
| --- | --- |
| `findings` | JSON array with rule, level, message, and workflow path where relevant |
| `passed` | JSON boolean; true when no error-level findings were recorded |

Findings also appear in the job summary. Report-only mode changes the step's exit status; it does not convert an unverified result into a pass.

## Files

`src/audit.mjs` contains the reusable settings audit; `src/index.mjs` handles the action entry point and reporting. `src/workflows.mjs` parses workflow YAML as data. `test/` covers both policies. `action.yml` points to the generated `dist/index.mjs`; GitHub runs that bundle without installing dependencies. The bundled YAML parser's license is in the [third-party notices](../docs/legal/THIRD_PARTY_NOTICES).
