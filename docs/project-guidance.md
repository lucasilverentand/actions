# Project guidance

This repository owns the reusable automation contracts. Each action's README and tests define its inputs, permissions, outputs, exclusions and failure behavior. Linear tracks active delivery and acceptance; GitHub pull requests carry source changes and validation.

## Accepted direction

Audit rules are tunable per caller while unverified inspections stay errors.

On 12 November 2026, the library was consolidated: message policies were retired in favour of the organization’s shared check; the gate receipt and workflow-policy PR re-checks were removed as unused safeguards. The release action remains for this repository, and branch cleanup remains because many repositories do not auto-delete merged branches.

On 11 November 2026, the library's scope expanded to recurring repository policies and release controls, with support for GitHub-hosted and self-hosted runners. Keep interfaces independent of particular runner names, organizations, infrastructure hosts or deployment products. Support Linux, macOS and Windows through the Node 24 action runtime; document extra tools needed by an operation and verify the runner matrix.

PR-only squash delivery, Conventional Commit messages and meaningful descriptions guide the baseline. Signing is not a universal commit requirement. Issue-key linkage and scope restrictions are explicit per-repository inputs. A text policy cannot prove that described tests ran or that an issue exists.

Audit results distinguish passing checks, policy violations and unverifiable inspections. Shared settings and workflow checks remain read-only. Default-branch auditing and pre-merge workflow inspection are separate capabilities; both inspect immutable content without executing it.

Branch removal and release publication require explicit activation. Deletion uses exact-tip evidence, fresh exclusions and a Git lease. Publication requires successful upstream jobs, a current default-branch SHA and immutable version tags. Bound parallel reads and keep mutations serial. Incomplete inventories and missing permissions must never become passes.

Fleet inventories and findings belong in a private controller or local report. Do not commit private inventories, internal source links, credentials or host-specific exceptions into this public library. No action automatically enrolls other repositories or migrates their infrastructure.

## Basis and boundaries

The existing [release contract](releases.md), [automation](automation.md), [repository audit](../repository-audit/README.md) and [branch cleanup](../branch-cleanup/README.md) form the baseline. The [CI gate](../ci-gate/README.md) generalizes the all-upstream-jobs-must-succeed pattern; the [release action](../release/README.md) reuses the tested planner and publisher. [Fleet audit](../fleet-audit/README.md) exposes the existing private inventory tool as an action.

Service checks, native signing, provisioning and production rollback remain owned by consuming repositories. Historical configurations and discontinued policies are not new requirements.

## Delivery and verification

Use a feature branch and pull request. Commit generated bundles with source. Build, test and manifest checks discover every root action. CI verifies reproducible bundles and dependency advisories across the hosted OS matrix. The aggregate `Verify` check preserves the required check name and fails if any matrix job fails or is skipped.

Examples pin the commit of a published release, as main did through v1.3.0. Since 12 Nov 2026 this repository's PR policy job runs the organization's shared PR message action, pinned to a default-branch commit of its repository, in place of the retired `pr-policy` action; it runs on a GitHub-hosted runner rather than through the shared reusable workflow because this public repository accepts fork PRs. Squash merges leave feature-branch commits off the default branch, so never pin them. After a release changes action behavior, a separate follow-up PR updates the pins to that release's commit. Interface additions and stricter checks that consumers adopt by moving an immutable pin are minor changes; reserve breaking markers for removed or incompatible interfaces and defaults. Runtime support and local tests do not establish that a particular private runner pool is online or admitted to this repository. Keep live acceptance explicit.
