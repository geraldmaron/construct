<!--
skills/utility/clean-code.md — AI Slop Removal — Patterns and heuristics for identifying and removing AI-generated code smells. U

Patterns and heuristics for identifying and removing AI-generated code smells. Use when cleaning up output from AI coding tools. ## Decision Tree
-->
# AI Slop Removal

Patterns and heuristics for identifying and removing AI-generated code smells. Use when cleaning up output from AI coding tools.

## Decision Tree

```
Is this comment derivable from the function/variable name?
  YES → Delete it

Is this variable named result, data, temp, item, obj, value, or response?
  YES → Rename to reflect what it actually contains

Is this a function that only calls one other function with no transformation?
  YES → Inline it at the call site

Is this a TODO/FIXME comment older than one session, or referencing cleanup that never happened?
  YES → Delete the comment and the dead code it describes

Is this catch block empty, returning null, or logging a generic "error occurred" message?
  YES → Fix: propagate, rethrow with context, or log the actual error

Is this docstring/JSDoc restating the parameter names without adding information?
  YES → Delete it
```

## 11 Smell Categories

### 1. Obvious Comments
Comments that restate what the code already says.
```
// BEFORE
// This function returns the sum of two numbers
function add(a, b) { return a + b; }

// AFTER
function add(a, b) { return a + b; }
```

### 2. Hedging Variable Names
Generic names that hide what the value represents.
```
// BEFORE
const result = await fetchUser(id);
const data = result.profile;

// AFTER
const user = await fetchUser(id);
const profile = user.profile;
```

### 3. Debug Artifacts
Leftover logging from development.
```
// BEFORE
console.log('entering loop', items);
for (const item of items) { ... }

// AFTER
for (const item of items) { ... }
```

### 4. Unnecessary Wrappers
Functions that only delegate without adding value.
```
// BEFORE
function getUser(id) { return userService.findById(id); }

// AFTER (inline at call site)
const user = await userService.findById(id);
```

### 5. Dead TODO Blocks
Stale markers and commented-out code.
```
// BEFORE
// TODO: remove this once the replacement flow ships
// const unusedUser = transformDraft(raw);

// AFTER
(deleted)
```

### 6. Restated Types
Type annotations that repeat the variable name.
```
// BEFORE
const userList: User[] = [];
const isLoadingFlag: boolean = false;

// AFTER
const users: User[] = [];
const isLoading = false;
```

### 7. Over-specified Test Assertions
Tests verifying implementation instead of behavior.
```
// BEFORE
expect(result.constructor.name).toBe('UserService');
expect(spy).toHaveBeenCalledWith(expect.objectContaining({ method: 'findById' }));

// AFTER
expect(result).toEqual(expectedUser);
```

### 8. Swallowed Errors
Catch blocks that discard context.
```
// BEFORE
try { await saveUser(user); } catch (e) { return null; }

// AFTER
try { await saveUser(user); } catch (e) {
  throw new Error(`Failed to save user ${user.id}: ${e.message}`);
}
```

### 9. Single-Use Abstractions
Helpers created for one call site.
```
// BEFORE
function buildUserQuery(id) { return { where: { id } }; }
const user = await db.user.findFirst(buildUserQuery(userId));

// AFTER
const user = await db.user.findFirst({ where: { id: userId } });
```

### 10. Padded Error Messages
Verbose error strings that obscure the actual failure.
```
// BEFORE
throw new Error('An unexpected error occurred while attempting to process the user authentication request');

// AFTER
throw new Error(`Authentication failed for user ${userId}`);
```

### 11. Boilerplate Docstrings
Documentation that adds no information.
```
// BEFORE
/**
 * Gets the user by ID.
 * @param id - The user ID
 * @returns The user
 */
async function getUserById(id: string): Promise<User> { ... }

// AFTER
async function getUserById(id: string): Promise<User> { ... }
```

## Rules

- Remove smell, nothing else. Do not refactor, reorganize, or add new abstractions.
- Keep diffs minimal — one smell per change where possible.
- Never change behavior. If a removal would change behavior, flag it instead.
- Show before/after for every change.
