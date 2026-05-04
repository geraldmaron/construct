<!-- PR Template -->
## Summary
- What: Brief (1 line)
- Why: Business/technical impact
- Changes: Key files touched

## Standards Checklist
- [ ] Coding standards (naming, immutability, no comments unless asked)
- [ ] TDD (80%+ coverage, unit/integration/E2E)
- [ ] Security review (no secrets, input validation)
- [ ] Tests pass + lint clean
- [ ] Docs updated (README/DESIGN if impacted)
- [ ] Beads ticket: `construct-XXX`

## Verification
```
npm test
npm run lint
construct verify-ci
```

Closes #XXX