# actions

Reusable GitHub Actions for review quality, CI gates, repository checks, releases, and conservative branch maintenance. Policies and code are public. Credentials, private inventories, and findings stay with the repositories being checked.

| Action | What it does | Access |
| --- | --- | --- |
| [PR policy](pr-policy/) | Validates Conventional Commit titles and Summary / Testing sections | No token or checkout |
| [Commit policy](commit-policy/) | Checks actual commit messages in immutable PR or push ranges | Read-only; no checkout |
| [Workflow policy](workflow-policy/) | Inspects changed workflow files before merge | Read-only; never executes PR code |
| [Repository audit](repository-audit/) | Reports configuration drift and unsafe workflow patterns | Read-only; some settings need an administrative read credential |
| [Fleet audit](fleet-audit/) | Audits accessible personal or organization repositories | Private controller and scoped read credential |
| [Branch cleanup](branch-cleanup/) | Previews old merged branches; deletion requires an explicit opt-in | Read-only for preview; Contents write for deletion |
| [CI gate](ci-gate/) | Requires upstream jobs to succeed and writes a source-specific receipt | No token or checkout |
| [Release](release/) | Previews or publishes immutable semantic versions after verification | Read-only preview; Contents write to publish |

Start with the [walkthrough and setup guide](docs/getting-started.md), then copy the workflows in [docs/examples/](docs/examples/) into a consuming repository. Examples pin reviewed implementation commits. Review updates and keep full commit pins.

For a read-only inventory across your personal or organization repositories, use the separate [fleet audit tool](tools/fleet-audit/). It runs locally or in a private controller and writes a private, ignored report.

All actions share one semantic version. CI calculates it from merged Conventional Commits and publishes [releases and notes](https://github.com/seventwo-studio/actions/releases) after verification. No local release command or version PR is needed. See the [release guide](docs/releases.md).

## Repository map

Each action folder contains its own usage reference, manifest, source, tests, and generated bundle. Shared helpers live in `lib/`; build utilities live in `scripts/`. The [architecture guide](docs/architecture.md) explains the layout, and the [automation guide](docs/automation.md) explains this repository's CI and nightly jobs.

These actions support GitHub.com and use the Node.js 24 action runtime on GitHub-hosted or self-hosted Linux, macOS and Windows runners. Consumers do not need to check out their code or install npm dependencies. Branch deletion additionally needs Git. See [runner compatibility](docs/runner-compatibility.md) and [project guidance](docs/project-guidance.md). Installing this library does not enroll other repositories or change their settings.

## Development

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check
```

Commit generated bundles with their source. CI verifies the build, tests, workflow policy, and known dependency advisories. See [contributing](.github/CONTRIBUTING.md), the [security policy](.github/SECURITY.md), [third-party notices](docs/legal/THIRD_PARTY_NOTICES), and the [MIT license](LICENSE).
