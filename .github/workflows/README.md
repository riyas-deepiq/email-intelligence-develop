# Workflows

## pr-review.yml

Runs on `pull_request` events (`opened`, `edited`, `reopened`, `synchronize`)
and has three jobs, two of which only run on a subset of those events.

A `concurrency` group (keyed on PR number) cancels any still-running job for
the same PR when a new one starts.

### validate-pr-title / validate-branch-name

Only run on `opened`, `edited`, `reopened` — **not** `synchronize` (every
push to the branch). These check PR title and branch naming conventions, not
code, so there's no need to re-run them on every commit.

`edited` is kept deliberately: if the title fails the check, editing it to
fix the issue is how the check re-runs and goes green.

### quality

Runs on every trigger, **including** `synchronize` — lint, typecheck, test,
and build need re-verifying on each commit pushed to the PR, unlike naming.
Equivalent to the old root `ci.yml`: `pnpm install --frozen-lockfile`,
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

### PR title

Must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(optional-scope): <description>
```

`feat` and `fix` additionally require an issue reference at the end:

```
<type>(optional-scope): <description> [#<issue-number>]
```

Examples:

```
feat: add individual account type [#123]
fix(onboarding): correct pricing rounding [#456]
chore: update ci workflow
docs: update README
```

### Branch name

Must follow:

```
<type>/<short-description>
```

Description is lowercase, words separated by hyphens. No issue/ticket key.

Examples:

```
feat/individual-onboarding
fix/pricing-rounding
chore/update-ci
hotfix/urgent-patch
```

### Type meanings

| Type | Meaning | Allowed in PR title | Allowed in branch name |
| --- | --- | --- | --- |
| `feat` | New feature or capability | Yes (needs `[#issue]`) | Yes |
| `fix` | Bug fix | Yes (needs `[#issue]`) | Yes |
| `chore` | Maintenance work with no production code change (deps, config, tooling) | Yes | Yes |
| `hotfix` | Urgent fix shipped outside the normal flow | No (use `fix` in the title) | Yes |
| `docs` | Documentation only | Yes | Yes |
| `style` | Formatting/whitespace, no logic change | Yes | Yes |
| `refactor` | Code change that is neither a fix nor a feature | Yes | Yes |
| `perf` | Performance improvement | Yes | Yes |
| `test` | Adding or fixing tests | Yes | Yes |
| `build` | Build system or dependency changes | Yes | Yes |
| `ci` | CI/CD configuration changes | Yes | Yes |
| `revert` | Reverts a previous commit | Yes | Yes |

`hotfix` branches are expected to be titled as `fix:` PRs (a hotfix is a fix
delivered urgently, not a distinct commit type).
