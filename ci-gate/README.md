# Required CI gate

Turn upstream job results into one stable required check. No token or checkout is required.

Use `if: always()` on the gate job, list **every** suite in its `needs`, and pass `needs: ${{ toJSON(needs) }}`. Require the gate's check name in branch protection. An omitted dependency cannot be discovered from the `needs` object; `required-jobs` catches accidental omissions of the named jobs.

Every supplied job must succeed. Empty dependency sets, missing results, failures, cancellations and skipped jobs fail. `allow-skipped` names deliberately optional jobs; it never excuses failed or absent jobs.

| Input | Default | Meaning |
| --- | --- | --- |
| `needs` | Required | The caller's `toJSON(needs)` object |
| `required-jobs` | `[]` | JSON array of additional job IDs that must be present |
| `allow-skipped` | `[]` | JSON array of explicitly optional jobs allowed to be skipped |

Outputs: `passed` (boolean) and `failures` (JSON). Findings also appear in the job summary.

See [the example](../docs/examples/ci-gate.yml) and [runner compatibility](../docs/runner-compatibility.md). The gate validates supplied job results; production, device and human acceptance remain separate.
