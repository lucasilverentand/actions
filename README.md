# actions

Reusable GitHub Actions for PR quality, repository configuration checks, and conservative branch maintenance. Policies and code are public. Credentials, private inventories, and findings stay with the repositories being checked.

| Action | What it does | Access |
| --- | --- | --- |
| [PR policy](pr-policy/) | Validates Conventional Commit titles and Summary / Testing sections | No token or checkout |
| [Repository audit](repository-audit/) | Reports configuration drift and unsafe workflow patterns | Read-only; some settings need an administrative read credential |
| [Branch cleanup](branch-cleanup/) | Previews old merged branches; deletion requires an explicit opt-in | Read-only for preview; Contents write for deletion |

Start with the [walkthrough and setup guide](docs/getting-started.md), then copy the workflows in [docs/examples/](docs/examples/) into a consuming repository. Examples pin reviewed implementation commits. Review updates and keep full commit pins.

For a read-only inventory across your personal repositories, use the separate [fleet audit tool](tools/fleet-audit/). It runs locally or in a private controller and writes a private, ignored report.

All actions share one semantic version and [changelog](CHANGELOG.md). The [release guide](docs/releases.md) explains how to prepare a version PR and how CI publishes it after verification.

## Repository map

Each action folder contains its own usage reference, manifest, source, tests, and generated bundle. Shared helpers live in `lib/`; build utilities live in `scripts/`. The [architecture guide](docs/architecture.md) explains the layout, and the [automation guide](docs/automation.md) explains this repository's CI and nightly jobs.

These actions support GitHub.com and use the Node.js 24 action runtime. Consumers do not need to check out their code or install dependencies. Installing this library does not enroll other repositories or change their settings.

## Development

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check
```

Commit generated bundles with their source. CI verifies the build, tests, workflow policy, and known dependency advisories. See [contributing](.github/CONTRIBUTING.md), the [security policy](.github/SECURITY.md), [third-party notices](docs/legal/THIRD_PARTY_NOTICES), and the [MIT license](LICENSE).
