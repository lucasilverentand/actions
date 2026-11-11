# Fleet audit

Run the repository audit across accessible, active repositories in an explicit personal or organization scope. Use this standalone command locally, or use the [fleet audit action](../../fleet-audit/) for scheduled runs in a private controller.

From the repository root:

```sh
npm ci --ignore-scripts
# Repositories owned by the authenticated personal account:
node tools/fleet-audit/index.mjs
# Repositories owned by a named organization:
node tools/fleet-audit/index.mjs --org seventwo-studio
# Limit simultaneous repository audits (default 2, range 1–4):
node tools/fleet-audit/index.mjs --org seventwo-studio --concurrency 2
```

The command uses `GH_TOKEN`, then `GITHUB_TOKEN`, or existing `gh` CLI authentication. A full audit needs Contents read, Administration read, and vulnerability alerts read for each selected repository. See the [audit reference](../../repository-audit/).

With personal credentials, the default scope is the authenticated account's owned repositories; `--org` uses that organization's accessible repositories instead. With an App installation token, discovery uses selected installation repositories and filters to the requested scope. Organization scope must be explicit. Archived, disabled, and fork repositories are excluded in both modes. The command cannot inspect repositories outside its credential's access, and it does not treat organization permission failures or a mismatched installation as a successful empty scan.

Reports go to `reports/audit.json` relative to the current working directory, with restrictive file permissions. The report records its scope. Console output contains totals; repository names and individual findings stay in the report. A nonzero exit status means errors or unverified inspections were found, or the inventory could not be completed.

Run locally or in a private controller repository. In GitHub Actions, the tool verifies the controller's private status through the API before scanning. Keep credentials and report retention in that private controller. Do not upload reports to public logs, summaries, issues, or artifacts. The root `.gitignore` excludes `reports/`.

`index.mjs` handles CLI authentication and invocation. `core.mjs` shares controller checks, report generation, and private file writing with the action. `inventory.mjs` handles explicit scope selection, discovery, and pagination; tests live in `test/`. To change audit rules, edit `repository-audit/src/` rather than adding a separate rule set here.
