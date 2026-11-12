# Runner compatibility

The public actions are bundled JavaScript actions with `runs.using: node24`. They are intended for GitHub-hosted and self-hosted Linux, macOS, and Windows runners that support this runtime. The Actions runner supplies its own Node executable; installing Node with `actions/setup-node` changes the job's development environment, not the action runtime. See the [runner's Node runtime documentation](https://github.com/actions/runner/blob/main/docs/checks/nodejs.md).

Consumers reference a reviewed full commit SHA. They do not need npm, dependencies installed in their workspace, or a checkout of their own code to execute these API and event-based actions. The generated bundles include JavaScript dependencies. A local `uses: ./action-name` reference, such as this library's own CI, needs a checkout so the action directory exists.

## Hosted runners

The repository CI runs the Node 24 test suite and bundle checks on `ubuntu-latest`, `macos-latest`, and `windows-latest`. The tests execute bundled entry points from temporary directories containing spaces, load bundles without repository dependencies, and exercise direct action outputs. Release smoke tests intercept network calls and reject mutations during preview. Branch deletion tests use a disposable local Git repository.

A passing matrix verifies those particular runner images. It does not prove compatibility with every custom image, CPU architecture, proxy, or credential setup. Check the PR's current CI results before adopting its immutable pin.

## Choosing a runner

The scheduled, manual and default-branch push examples read an optional `AUTOMATION_RUNNER` repository or organization variable. Leave it unset for GitHub-hosted `ubuntu-latest`. Set it to a JSON runner selector to use your own runners, for example `["self-hosted", "linux"]` or `{"group": "private-runners", "labels": ["linux"]}`. One variable switches every copied workflow without editing it.

PR-triggered examples (PR policy, workflow policy and the CI gate) stay on GitHub-hosted runners. A fork PR can change the workflow it runs, so persistent runners need more than a runner choice. In a private repository without fork PRs, you can use the same selector there. Keep self-hosted runner groups unavailable to public repositories, which is GitHub's default. The workflow linter cannot resolve a runner chosen through a variable.

## Self-hosted runners

Use a current Actions runner on a supported operating system and architecture with a working bundled Node 24 runtime. On Linux, the operating system's C library and other runtime libraries must support that runner's Node binary. Changing the Node version on `PATH` does not repair an incompatible bundled action runtime. GitHub maintains the supported platforms and network requirements in its [self-hosted runner reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).

The runner needs outbound HTTPS connectivity to GitHub's required Actions services. API-based actions also access `api.github.com`; branch deletion uses Git over HTTPS to `github.com`. Configure trusted certificates and permitted destinations for the runner and its Node runtime. This library currently supports GitHub.com; its API clients reject a custom `GITHUB_API_URL`.

Most actions need no external executable. **Branch cleanup requires Git 2.31 or newer on `PATH` only when deletion is explicitly enabled**; its preview uses the GitHub API. Git must support `push --force-with-lease` and the runner must be able to create and remove its temporary directory. The permission and event restrictions documented by each action still apply.

Credentials and repository data remain subject to the consuming repository's access controls; runner selection does not widen their scope.

Proxy-based runners are supported through standard `HTTP_PROXY`/`HTTPS_PROXY` and lowercase variants, plus `NO_PROXY`/`no_proxy`. Automatic proxy setup uses [Node's built-in proxy configuration](https://nodejs.org/api/http.html#httpsetglobalproxyfromenvproxyenv), available from Node 24.14. Older Node 24 runner runtimes must start with `NODE_USE_ENV_PROXY=1`. Configure `NODE_EXTRA_CA_CERTS` before the runner starts when Node needs an additional trusted CA. Branch deletion preserves only approved Git TLS/proxy settings from runner configuration, while isolating credentials, hooks and repository routing.
