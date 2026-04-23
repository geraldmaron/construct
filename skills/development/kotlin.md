<!--
skills/development/kotlin.md — Kotlin / Android Development — | Scope | Use when |

## Coroutines & Flows ### Coroutine scope discipline
-->
# Kotlin / Android Development

## Coroutines & Flows

### Coroutine scope discipline

| Scope | Use when |
|---|---|
| `viewModelScope` | ViewModel-bound work; auto-cancelled on clear |
| `lifecycleScope` | Fragment/Activity-bound; cancelled on destroy |
| `rememberCoroutineScope()` | Compose-scoped; cancelled on composition exit |
| `GlobalScope` | Never — uncontrolled lifetime |

```kotlin
class ItemViewModel(private val repo: ItemRepository) : ViewModel() {
  private val _items = MutableStateFlow<List<Item>>(emptyList())
  val items: StateFlow<List<Item>> = _items.asStateFlow()

  init {
    viewModelScope.launch {
      repo.itemsFlow().collect { _items.value = it }
    }
  }
}
```

### Flow operators

- `stateIn(scope, SharingStarted.WhileSubscribed(5_000), initial)` — converts cold flow to hot StateFlow for UI consumption
- `map`, `filter`, `distinctUntilChanged`, `debounce` for transform chains
- `combine` for merging multiple flows
- Use `flowOn(Dispatchers.IO)` for upstream CPU/IO work; do not switch dispatchers in the collector

### Dispatcher guidelines

| Dispatcher | Use for |
|---|---|
| `Dispatchers.Main` | UI updates |
| `Dispatchers.IO` | Network, disk, database |
| `Dispatchers.Default` | CPU-intensive work |
| `Dispatchers.Unconfined` | Rarely — only in tests |

## Jetpack Compose

### State hoisting

Hoist state to the lowest common owner. Stateless composables receive state and callbacks:

```kotlin
@Composable
fun ItemList(items: List<Item>, onDelete: (Item) -> Unit) { ... }
```

### Side effects

| Effect | Use when |
|---|---|
| `LaunchedEffect(key)` | Coroutine that re-launches when key changes |
| `SideEffect` | Sync non-Compose state each recomposition |
| `DisposableEffect(key)` | Setup/teardown with cleanup |
| `rememberUpdatedState` | Capture latest lambda in long-lived effect |

### Performance

- `remember` expensive computations with stable keys
- `key(id) { ... }` in lazy lists to preserve item identity
- Avoid unstable lambdas — use `remember { { ... } }` or stable function references
- Enable Compose compiler metrics to detect recomposition hot spots
- Prefer `LazyColumn` over `Column` for variable-length lists

## Architecture: Clean + MVVM

```
UI Layer (Composables) → ViewModel (StateFlow) → Domain (UseCases) → Data (Repository) → API / DB
```

- Domain layer is pure Kotlin, no Android dependencies
- Repository abstracts data sources; returns `Flow` or `Result`
- UseCases wrap single business operations; testable in isolation

## Testing

### Unit tests (JUnit 5 + MockK)

```kotlin
@Test
fun `fetchItems returns mapped items`() = runTest {
  val repo = mockk<ItemRepository>()
  coEvery { repo.fetchAll() } returns listOf(Item(id = "1", title = "Test"))
  val vm = ItemViewModel(repo)
  assertEquals(1, vm.items.value.size)
}
```

- Use `runTest` from `kotlinx-coroutines-test` for coroutine unit tests
- `advanceUntilIdle()` to drain pending coroutines
- `turbine` library for Flow assertion (`flow.test { assertItem() }`)

### UI tests (Compose testing)

```kotlin
composeTestRule.onNodeWithText("Submit").performClick()
composeTestRule.onNodeWithTag("result").assertIsDisplayed()
```

- Prefer semantic matchers (`onNodeWithContentDescription`) over positional
- Use `createComposeRule()` for isolated component tests

## Dependency Injection

Use **Hilt** (Dagger-backed) for Android projects. Annotate entry points correctly:

```kotlin
@HiltViewModel
class ItemViewModel @Inject constructor(
  private val repo: ItemRepository
) : ViewModel()
```

Scoping: `@Singleton` for app-scoped, `@ActivityRetainedScoped` for ViewModel-lived, `@ActivityScoped` for Activity-lived.

## Build & Tooling

- **Gradle Version Catalogs** (`libs.versions.toml`) for dependency management
- Enable R8 / ProGuard in release builds for shrinking and obfuscation
- **Kotlin Symbol Processing (KSP)** instead of KAPT for annotation processing
- `detekt` for static analysis; `ktlint` for formatting
- Minimum SDK: follow Play Store distribution requirements (API 26+ covers ~95%)

## Common Pitfalls

- `collect` in `Fragment.onViewCreated` without `repeatOnLifecycle(STARTED)` — causes collection after view destruction
- `StateFlow.value` reads in tests without collecting — use `turbine` or `runTest { first() }`
- Leaking `Activity` context into long-lived objects — use `applicationContext`
- `LazyColumn` with `items(list)` where `list` is `State<List<...>>` causing full recomposition — use `key` param
