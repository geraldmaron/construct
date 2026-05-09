<!--
skills/development/swift.md — Swift / iOS Development — Swift 6 enforces data-race safety at compile time. Annotate isolation boundary e

## Concurrency (Swift 6 Strict Concurrency) Swift 6 enforces data-race safety at compile time. Annotate isolation boundary explicitly:
-->
# Swift / iOS Development

## Concurrency (Swift 6 Strict Concurrency)

Swift 6 enforces data-race safety at compile time. Annotate isolation boundary explicitly:

```swift
@MainActor
final class ViewModel: ObservableObject {
  @Published var items: [Item] = []

  func load() async {
    items = await repository.fetchAll()
  }
}
```

Key rules:
- `@MainActor` for all UI-touching types
- `actor` for shared mutable state accessed off the main thread
- `Sendable` conformance on types crossing isolation boundaries
- Prefer `async/await` over completion handlers; avoid mixing the two

Common pitfall: `Task { }` inherits the actor context of its caller — do not assume it runs on a background thread.

## SwiftUI Patterns

### State ownership hierarchy

| Wrapper | Use when |
|---|---|
| `@State` | Local, view-owned, value type |
| `@StateObject` | View-owned reference type (creates once) |
| `@ObservedObject` | Reference type owned by a parent |
| `@EnvironmentObject` | Shared across subtree without explicit passing |
| `@Binding` | Two-way write access into parent state |

### Prefer value semantics in models

```swift
struct Item: Identifiable, Hashable {
  let id: UUID
  var title: String
}
```

Avoid `class` for model types unless reference semantics are required.

### Navigation

Use `NavigationStack` + `navigationDestination(for:)` for type-safe push navigation. Avoid `NavigationView` (deprecated in iOS 16+).

```swift
NavigationStack(path: $router.path) {
  ContentView()
    .navigationDestination(for: Route.self) { route in
      route.view
    }
}
```

## Testing

### Unit tests

Use `XCTest` for synchronous logic and `async` test methods for concurrency:

```swift
func testFetchReturnsItems() async throws {
  let sut = ItemRepository(api: MockAPI())
  let result = try await sut.fetchAll()
  XCTAssertFalse(result.isEmpty)
}
```

### UI tests

Prefer `XCUITest` for critical flows only — it is slow and flaky. Supplement with snapshot tests (`swift-snapshot-testing`) for visual regression.

### Test doubles

Declare protocols for dependencies; inject fakes in tests:

```swift
protocol APIClient { func fetch() async throws -> [Item] }
struct MockAPIClient: APIClient { var stubbedItems: [Item] = [] }
```

## Memory Management

- Capture lists in closures: `[weak self]` to break retain cycles
- Actors do not need `[weak self]` captures for their own methods
- Use Instruments → Leaks / Allocations to profile before optimizing

## Build & Tooling

- **Swift Package Manager** for libraries; avoid CocoaPods on new projects
- **Xcode Cloud** or **Fastlane** for CI
- Enable `-strict-concurrency=complete` in Swift 5.x projects to prepare for Swift 6
- `swiftlint` for style; `swiftformat` for formatting
- Minimum deployment targets: follow current App Store requirements (iOS 16+ as of 2025)

## Architecture Patterns

### MVVM + Repository

```
View → ViewModel (@MainActor) → Repository (actor) → Network/DB
```

- ViewModels hold `@Published` properties; Views observe them
- Repositories own async data access; isolated with `actor`
- Business logic lives in domain models, not ViewModels

### The Composable Architecture (TCA)

Use TCA when state fan-out is complex or testability of reducers is a priority. Adds boilerplate — evaluate against team familiarity.

## Common Pitfalls

- Do not call `@MainActor` methods from synchronous non-main contexts — use `Task { @MainActor in ... }`
- Avoid `DispatchQueue.main.async` in new code; use `await MainActor.run { }` instead
- `@StateObject` vs `@ObservedObject` confusion causes double-initialization bugs — `@StateObject` only at the owner
- `List` with large datasets: use `lazy` loading or pagination; do not load everything into `@State`
