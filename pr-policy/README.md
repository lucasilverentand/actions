# PR policy

Check pull request titles and bodies before merging. The action reads the event payload as data; it needs no token, secrets, or checkout.

Copy the [example workflow](../docs/examples/pr-policy.yml). Run it on `pull_request` events, including `edited` so changes to the title and body trigger another check. Add the resulting check to the consuming repository's required status checks.

## Title rules

Titles use `type(optional-scope)!: description`. Allowed types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`.

```text
fix(parser): handle empty documents
feat!: simplify the configuration format
docs: clarify setup instructions
```

The default maximum is 100 Unicode code points for the complete title and 72 for the summary after the type and optional scope. Set `allow-scopes: 'false'` where the repository requires unscoped subjects. Surrounding whitespace, control characters, directional overrides, and multiline titles fail.

## Body rules

Bodies need Summary and Testing sections with at least 12 letters or numbers in each. Headings are case-insensitive, and nested subsections remain part of their parent. The usual format is:

```markdown
## Summary

Handle empty documents without throwing an exception.

## Testing

Ran the parser unit tests, including empty input cases.
```

Comments, fenced examples, formatting-only sections, and placeholder-only answers do not satisfy the check. Explain skipped tests, for example: “Not run: documentation-only changes.” There are no bot exemptions.

Enable `require-issue-reference: 'true'` to require a tracked work item in the PR body. A visible issue key such as `ENG-123`, including a linked issue URL, satisfies the check. `issue-prefixes: '["ENG", "OPS"]'` restricts accepted teams. Hidden comments, fenced examples, and inline-code examples do not count. This is a syntax check; it does not contact the issue tracker or verify the issue's existence, acceptance, or relationship to the change.

The action checks structure. It cannot verify whether the described tests ran or whether the description accurately explains the change. Conventional Commit types and required section names remain policy in the source.

## Interface

| Input | Default | Meaning |
| --- | --- | --- |
| `max-title-length` | `100` | Maximum Unicode code points; accepts 40–200 |
| `max-summary-length` | `72` | Maximum code points after the type and optional scope; accepts 1–200 |
| `allow-scopes` | `true` | Allow `fix(parser): ...`; set false for unscoped subjects |
| `require-issue-reference` | `false` | Require a visible tracked issue key in the body |
| `issue-prefixes` | `[]` | JSON array of uppercase issue keys; empty allows any prefix |

The `valid` output is a JSON boolean. A violation fails the step and writes guidance to the job summary.

Configure squash commits to use the PR title and body if you want the validated text to become the commit message. This is a repository setting; the action does not change it.

Compared with the original policy, the 72-character summary bound and stronger rejection of empty Markdown are stricter defaults. Consumers that need the previous summary allowance can set `max-summary-length: '100'`. Adopt an updated immutable pin deliberately.

## Files

`action.yml` declares the public interface. `src/index.mjs` implements the policy; `test/` covers it. `dist/index.mjs` is the generated, self-contained file GitHub executes. Rebuild it with `npm run build` from the repository root.
