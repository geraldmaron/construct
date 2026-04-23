<!--
skills/devops/git-workflow.md — Git Workflow — Use this skill when establishing branching strategies, commit conventions, or co

Use this skill when establishing branching strategies, commit conventions, or code integration practices. ## Branching Strategies
-->
# Git Workflow

Use this skill when establishing branching strategies, commit conventions, or code integration practices.

## Branching Strategies

### Trunk-Based Development
- Main branch is always deployable
- Short-lived feature branches (1-2 days max)
- Feature flags for incomplete work
- Best for: teams with strong CI/CD and automated testing
- Requires: comprehensive test suites, fast builds

### GitHub Flow
- `main` is always deployable
- Feature branches created from `main`
- Pull request for review; merge to `main` after approval
- Deploy from `main` after merge
- Best for: most teams, SaaS products

### GitFlow
- `main` for production, `develop` for integration
- Feature branches from `develop`, release branches for stabilization
- Hotfix branches from `main` for urgent fixes
- Best for: projects with scheduled releases
- Overhead is high; avoid unless release cadence demands it

## Commit Conventions

### Format
```
<type>(<scope>): <description>

<optional body>

<optional footer>
```

### Types
- `feat`: new feature
- `fix`: bug fix
- `refactor`: code change that neither fixes nor adds
- `docs`: documentation only
- `test`: adding or updating tests
- `chore`: build, CI, dependency updates
- `perf`: performance improvement
- `ci`: CI/CD configuration changes

### Rules
- Subject line: imperative mood, <72 characters
- Body: explain what and why, not how
- Footer: reference issues (`Closes #123`) or note breaking changes
- One logical change per commit
- Atomic commits: each commit should build and pass tests

## Pull Request Process

1. Branch from the latest base branch
2. Keep PRs small: <400 lines changed when possible
3. Self-review before requesting others
4. Write a description: what changed, why, how to test
5. Link related issues
6. All CI checks must pass before merge
7. At least one approval required
8. Squash merge for clean history; merge commit when individual commits matter

## Code Review Guidelines

- Review within 24 hours of request
- Focus on: correctness, security, maintainability, test coverage
- Use severity labels: Critical, High, Medium, Low
- Approve with minor comments; block only for Critical/High
- Praise good patterns; review is not only for finding problems

## Merge Conflict Resolution

- Rebase feature branch on latest base branch frequently
- Resolve conflicts locally, not in the merge UI
- Re-run tests after conflict resolution
- When in doubt, ask the original author

## Release Tagging

- Semantic versioning: MAJOR.MINOR.PATCH
- Tag releases on `main` after deployment verification
- Generate changelog from conventional commits
- Sign tags for authenticity when required

## Repository Hygiene

- Delete merged branches automatically
- Protect `main`: require PR, require CI, no force push
- `.gitignore` covers build artifacts, dependencies, environment files
- No large binaries in the repo; use Git LFS or external storage
- Commit messages reference issue trackers for traceability
