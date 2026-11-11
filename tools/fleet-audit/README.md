# Fleet audit

Run the repository audit across accessible, active repositories owned by the authenticated personal account. This is a standalone operator tool, separate from the three GitHub Actions.

From the repository root:

```sh
npm ci --ignore-scripts
node tools/fleet-audit/index.mjs
```

The command uses `GH_TOKEN`, then `GITHUB_TOKEN`, or existing `gh` CLI authentication. A full audit needs Contents read, Administration read, and vulnerability alerts read for each selected repository. See the [audit reference](../../repository-audit/).

Personal credentials discover owned repositories visible to that account. GitHub App installation credentials use the installation's selected personal repositories. Organization-owned, archived, disabled, and fork repositories are excluded. The command cannot inspect repositories outside its credential's access.

Reports go to `reports/audit.json` relative to the current working directory, with restrictive file permissions. Console output contains totals; repository names and individual findings stay in the report. A nonzero exit status means errors or unverified inspections were found, or the inventory could not be completed.

Run locally or in a private controller repository. In GitHub Actions, the tool verifies the controller's private status through the API before scanning. Keep credentials and report retention in that private controller. Do not upload reports to public logs, summaries, issues, or artifacts. The root `.gitignore` excludes `reports/`.

`index.mjs` handles authentication, privacy checks, reporting, and invocation of the shared audit. `inventory.mjs` handles discovery and pagination; its tests live in `test/`. To change audit rules, edit `repository-audit/src/` rather than adding a separate rule set here.
