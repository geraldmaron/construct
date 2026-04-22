<!--
skills/development/java.md — Java Best Practices — Use this skill when writing, reviewing, or debugging Java or Kotlin code on the

Use this skill when writing, reviewing, or debugging Java or Kotlin code on the JVM. ## Project Structure
-->
# Java Best Practices

Use this skill when writing, reviewing, or debugging Java or Kotlin code on the JVM.

## Project Structure

```
src/
  main/
    java/com/example/
      controller/
      service/
      repository/
      model/
      config/
    resources/
      application.yml
  test/
    java/com/example/
      controller/
      service/
pom.xml or build.gradle.kts
```

- Maven or Gradle for build management
- Follow standard Maven directory layout
- One class per file; package by feature when the project is large

## Tooling

| Tool | Purpose |
|---|---|
| javac / kotlinc | Compilation |
| Checkstyle / ktlint | Code style enforcement |
| SpotBugs / ErrorProne | Static analysis |
| JUnit 5 / Kotest | Testing |
| Mockito / MockK | Mocking |
| JaCoCo | Coverage |
| OWASP Dependency Check | Vulnerability scanning |

## Type Safety

- Use `Optional<T>` for values that may be absent; never return null from public methods
- Records (Java 16+) or data classes (Kotlin) for immutable value objects
- Sealed interfaces for closed type hierarchies
- Generics with bounded wildcards: `<? extends T>` for producers, `<? super T>` for consumers
- Avoid raw types; always parameterize generics

## Error Handling

- Use checked exceptions for recoverable conditions; unchecked for programming errors
- Custom exception hierarchy extending `RuntimeException` for domain errors
- Never catch `Exception` or `Throwable` unless at the top-level handler
- Include context: `throw new OrderNotFoundException("Order " + id + " not found")`
- Use try-with-resources for all `AutoCloseable` resources
- Log at the point of handling, not at the point of throwing

## Immutability

- Records (Java) or data classes (Kotlin) for immutable data
- `final` fields and classes by default
- `Collections.unmodifiableList()` or `List.of()` for immutable collections
- Avoid setters; use builder pattern or `with` methods that return new instances
- Kotlin: `val` over `var`; `listOf` over `mutableListOf` unless mutation is required

## Patterns

### Dependency Injection
- Constructor injection (not field injection)
- Spring: `@Component`, `@Service`, `@Repository` stereotypes
- Interface-based dependencies for testability
- Avoid circular dependencies; restructure if detected

### Repository Pattern
- Interface defines data access contract
- Implementation handles persistence details
- Spring Data: derive queries from method names; use `@Query` for complex queries
- Pageable for list operations

### Stream API
- Prefer streams over manual loops for collection processing
- `map`, `filter`, `collect` for transformations
- `Optional.map`/`flatMap` for null-safe chaining
- Avoid side effects in stream operations
- Use parallel streams only with benchmarking evidence

## Testing

- JUnit 5 with `@Test`, `@ParameterizedTest`, `@Nested`
- Mockito for mocking external dependencies
- `@SpringBootTest` for integration tests; `@WebMvcTest` for controller tests
- Testcontainers for database and infrastructure integration tests
- AssertJ for fluent assertions
- Test naming: `should_returnEmpty_when_noResultsMatch`

## Performance

- Profile with JFR (Java Flight Recorder) and JMC (Mission Control)
- GC tuning: choose G1 or ZGC based on latency requirements
- Connection pooling: HikariCP for database, Apache HttpClient for HTTP
- Avoid unnecessary object creation in hot paths
- Use `StringBuilder` for string concatenation in loops
- JMH for microbenchmarks

## Spring Boot Specifics

- Externalize configuration: `application.yml` with profiles
- Actuator endpoints for health, metrics, and info
- Use `@ConfigurationProperties` over `@Value` for structured config
- Validate configuration with `@Validated`
- Global exception handler with `@ControllerAdvice`

## Security

- Spring Security for authentication and authorization
- Parameterized queries via JPA or Spring JDBC
- Input validation with Bean Validation (`@Valid`, `@NotNull`, `@Size`)
- OWASP Dependency Check in CI
- Never log sensitive data; mask PII in logs
- Use BCrypt for password hashing

## Anti-Patterns

- Service locator instead of dependency injection
- God classes with mixed responsibilities
- Catch-and-ignore empty catch blocks
- Null returns instead of `Optional`
- Mutable DTOs shared across layers
- Over-engineering: unnecessary abstract factories and strategy patterns
