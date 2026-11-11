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

The default maximum is 100 Unicode code points. Surrounding whitespace, control characters, and multiline titles fail.

## Body rules

Bodies need Summary and Testing sections with at least 12 characters of meaningful content in each. Headings are case-insensitive; the usual format is:

```markdown
## Summary

Handle empty documents without throwing an exception.

## Testing

Ran the parser unit tests, including empty input cases.
```

Comments, empty sections, and placeholder-only answers do not satisfy the check. Explain skipped tests, for example: “Not run: documentation-only changes.” There are no bot exemptions.

The action checks structure. It cannot verify whether the described tests ran or whether the description accurately explains the change. Conventional Commit types and required section names are policy in the source; only the title length is an input.

## Interface

| Input | Default | Meaning |
| --- | --- | --- |
| `max-title-length` | `100` | Maximum Unicode code points; accepts 40–200 |

The `valid` output is a JSON boolean. A violation fails the step and writes guidance to the job summary.

Configure squash commits to use the PR title and body if you want the validated text to become the commit message. This is a repository setting; the action does not change it.

## Files

`action.yml` declares the public interface. `src/index.mjs` implements the policy; `test/` covers it. `dist/index.mjs` is the generated, self-contained file GitHub executes. Rebuild it with `npm run build` from the repository root.
