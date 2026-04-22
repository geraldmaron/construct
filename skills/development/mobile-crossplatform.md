<!--
skills/development/mobile-crossplatform.md — Mobile Cross-Platform Development — Before choosing a framework, answer:

## Decision Framework: Native vs Cross-Platform Before choosing a framework, answer:
-->
# Mobile Cross-Platform Development

## Decision Framework: Native vs Cross-Platform

Before choosing a framework, answer:

| Question | Leans native | Leans cross-platform |
|---|---|---|
| Platform-specific APIs needed (ARKit, Health, NFC)? | Yes | No |
| Animation fidelity is a differentiator? | Yes | Partial |
| Single team, both platforms? | — | Yes |
| Heavy use of platform OS widgets? | Yes | No |
| App is primarily data-display / CRUD? | — | Yes |
| Existing web team? | — | React Native |
| Existing Kotlin/Swift team? | Native | — |

---

## Flutter

**Runtime:** Dart compiled to native ARM; Skia/Impeller rendering engine (no platform widgets by default).

**Best for:** pixel-perfect UI consistency across iOS/Android/web/desktop from a single codebase. Strong for teams without web background.

### Architecture pattern: BLoC / Riverpod

```dart
@riverpod
Future<List<Item>> items(ItemsRef ref) async {
  return ref.watch(repositoryProvider).fetchAll();
}
```

- `riverpod` for dependency injection and async state
- `BLoC` for complex event-driven state machines
- Avoid `StatefulWidget` + `setState` beyond leaf components

### Performance

- `const` constructors everywhere possible — eliminates widget rebuilds
- `RepaintBoundary` around independently-animated subtrees
- Profile with Flutter DevTools → CPU flame chart + widget rebuild tracker
- `ListView.builder` for lazy lists; never `ListView(children: [...])` for long lists

### Testing

```dart
testWidgets('shows items on load', (tester) async {
  await tester.pumpWidget(ProviderScope(child: ItemList()));
  await tester.pumpAndSettle();
  expect(find.text('Item 1'), findsOneWidget);
});
```

- `flutter_test` for widget tests (fast, no device needed)
- `integration_test` for E2E on real device / emulator
- `mocktail` or `mockito` for mocking

### Tooling

- `flutter analyze` + `dart format`
- `very_good_cli` for project scaffolding with opinionated defaults
- `flutter_flavorizr` for environment flavors (dev/staging/prod)

---

## React Native

**Runtime:** JavaScript/TypeScript on Hermes engine; bridges to native views via the New Architecture (JSI + Fabric).

**Best for:** Teams with React web experience sharing logic/types between web and mobile.

### New Architecture (React Native 0.74+)

Enable the New Architecture by default on new projects. Key changes:
- JSI replaces the async bridge — sync native calls
- Fabric replaces the native renderer — concurrent React features work correctly
- TurboModules replace native modules

### State & logic sharing with web

```ts
// Shared hook — works in React Native and React web
export function useItems() {
  const { data } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
  return data ?? [];
}
```

- Share: types, API clients, business logic hooks, validation schemas
- Do not share: navigation, platform-specific UI, native module wrappers

### Navigation

Use **Expo Router** (file-based) for new projects or **React Navigation** (stack/tab/drawer) for maximum control:

```tsx
// expo-router
export default function ItemScreen() { ... }
// file: app/items/[id].tsx → /items/:id
```

### Performance

- Use the Hermes profiler to find JS thread bottlenecks
- Move heavy computation to native modules or worklets (`react-native-reanimated`)
- `FlatList` with `getItemLayout` for fixed-height rows; `FlashList` for variable heights
- Enable `useMemo` / `useCallback` sparingly and only after measuring

### Expo vs bare React Native

| | Expo (managed) | Bare RN |
|---|---|---|
| Setup speed | Fast | Slower |
| Custom native code | EAS custom builds | Full control |
| Over-the-air updates | Expo Updates | Manual setup |
| Recommended for | Most new projects | Deep native integration |

### Testing

- `@testing-library/react-native` for component tests
- `Detox` or `Maestro` for E2E

---

## Common Pitfalls (both frameworks)

- **Deep linking not tested until late** — set up universal links / app links in week 1
- **Push notifications complexity** — Expo Notifications or Firebase Cloud Messaging; plan for permission states
- **Over-the-air update strategy** — define what can be OTA vs what requires App Store review
- **Platform capability divergence** — features available on iOS 17+ may be absent on Android 12; maintain a capability matrix
- **Code signing automation** — `fastlane match` (iOS) and keystore management (Android) require upfront investment; do it early

## When to go native anyway

- Camera pipelines, real-time audio/video processing
- Tight OS integration (CarPlay, watchOS, Android Auto)
- Games or high-frame-rate interactive graphics
- Health / fitness sensors with continuous background access
