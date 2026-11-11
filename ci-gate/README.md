# Required CI gate

Turn upstream job results into one stable required check, and write a compact receipt tied to the workflow's source SHA and run. No token or checkout is required.

Use `if: always()` on the gate job, list **every** suite in its `needs`, and pass `needs: ${{ toJSON(needs) }}`. Require the gate's check name in branch protection. An omitted dependency cannot be discovered from the `needs` object; `required-jobs` catches accidental omissions of the named jobs.

Every supplied job must succeed. Empty dependency sets, missing results, failures, cancellations and skipped jobs fail. `allow-skipped` names deliberately optional jobs; it never excuses failed or absent jobs.

| Input | Default | Meaning |
| --- | --- | --- |
| `needs` | Required | The caller's `toJSON(needs)` object |
| `required-jobs` | `[]` | JSON array of additional job IDs that must be present |
| `allow-skipped` | `[]` | JSON array of explicitly optional jobs allowed to be skipped |

Outputs: `passed` (boolean), `failures` (JSON), `receipt-path` (ordinary path string). The receipt contains results, repository, source SHA, run ID and attempt. Upstream job outputs are excluded because they can contain sensitive values. Retain the file with an artifact step if needed. Local use without `RUNNER_TEMP` produces no receipt file.

See [the example](../docs/examples/ci-gate.yml) and [runner compatibility](../docs/runner-compatibility.md). The gate validates supplied job results; production, device and human acceptance remain separate.
