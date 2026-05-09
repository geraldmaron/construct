<!--
rules/common/development-workflow.md — feature implementation pipeline.

Defines the research-plan-TDD-review-commit workflow that runs before
git operations. References testing.md, code-review.md, git-workflow.md.
-->
# Development Workflow

## Feature Implementation Workflow

0. **Research & Reuse** _(mandatory before any new implementation)_
   - **Search existing code first:** Look for existing implementations, templates, and patterns before writing anything new.
   - **Check docs:** Confirm API behavior, package usage, and version-specific details before implementing.
   - **Check package registries:** npm, PyPI, crates.io before writing utility code.
   - Prefer adopting a proven approach over writing net-new code.

1. **Plan** - Break into phases; identify dependencies and risks.

2. **TDD** - Write tests first (RED), implement (GREEN), refactor (IMPROVE). See [testing.md](testing.md).

3. **Code Review** - Review immediately after writing. See [code-review.md](code-review.md).

3.5. **Docs** _(mandatory for any user-facing change)_
   - If you added or changed a CLI command, API endpoint, config option, or architecture boundary: update `docs/architecture.md` and create or update the relevant `docs/how-to/` guide.
   - If you added a CLI command, ensure `docs/README.md` how-to list links to a guide for it.
   - Run `construct docs:update` to regenerate AUTO-managed regions.
   - A change is not DONE if a user-facing capability exists with no documentation.

4. **Commit** - Conventional commits format. See [git-workflow.md](git-workflow.md).

5. **Pre-Review Checks** - CI passing, conflicts resolved, branch synced.
