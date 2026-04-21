<!--
skills/frameworks/spring-boot.md — Spring Boot — ```

## Project Structure ```
-->
# Spring Boot

## Project Structure

```
src/
├── main/
│   ├── kotlin/com/example/app/
│   │   ├── Application.kt          ← @SpringBootApplication entry
│   │   ├── config/                 ← @Configuration classes
│   │   ├── domain/                 ← Entities, value objects
│   │   ├── repository/             ← Spring Data repositories
│   │   ├── service/                ← Business logic (@Service)
│   │   ├── web/                    ← Controllers (@RestController)
│   │   │   ├── dto/                ← Request/response DTOs
│   │   │   └── advice/             ← @ControllerAdvice
│   │   └── security/               ← Security config
│   └── resources/
│       ├── application.yml
│       └── db/migration/           ← Flyway migrations
└── test/
```

## Layered Architecture

```
@RestController → @Service → @Repository → DB
```

- **Controller**: validate input, delegate to service, map to DTO
- **Service**: business logic; transaction boundary; no JPA entities exposed outside layer
- **Repository**: data access only; query methods or `@Query`
- **Domain**: pure entities with business behavior; no Spring dependencies

Never inject repositories directly into controllers.

## REST Controllers

```kotlin
@RestController
@RequestMapping("/api/items")
class ItemController(private val itemService: ItemService) {

  @GetMapping("/{id}")
  fun getItem(@PathVariable id: UUID): ResponseEntity<ItemDto> =
    itemService.findById(id)
      ?.let { ResponseEntity.ok(it.toDto()) }
      ?: ResponseEntity.notFound().build()

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  fun createItem(@Valid @RequestBody req: CreateItemRequest): ItemDto =
    itemService.create(req).toDto()
}
```

Use `@Valid` + Bean Validation (`@NotBlank`, `@Size`, etc.) for input validation. Handle `MethodArgumentNotValidException` in `@ControllerAdvice`.

## JPA / Spring Data

```kotlin
@Entity
@Table(name = "items")
class Item(
  @Id val id: UUID = UUID.randomUUID(),
  @Column(nullable = false) var title: String,
  @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "owner_id") val owner: User,
)

interface ItemRepository : JpaRepository<Item, UUID> {
  fun findByOwnerAndStatus(owner: User, status: Status): List<Item>

  @Query("SELECT i FROM Item i JOIN FETCH i.owner WHERE i.id = :id")
  fun findByIdWithOwner(id: UUID): Item?
}
```

- Default `FetchType.LAZY` for associations — never `EAGER`
- Use `JOIN FETCH` in queries when you need the association
- Enable `spring.jpa.open-in-view=false` — prevents lazy-loading in the web layer
- Use Flyway or Liquibase for schema migrations; never `ddl-auto=update` in production

## Transactions

```kotlin
@Service
@Transactional(readOnly = true)   // default for the class
class ItemService(private val repo: ItemRepository) {

  @Transactional                  // write override
  fun create(req: CreateItemRequest): Item {
    val item = Item(title = req.title, owner = currentUser())
    return repo.save(item)
  }
}
```

- `@Transactional` on service layer, not repository or controller
- `readOnly = true` as class-level default; override on writes — signals no dirty-check needed
- Do not call `@Transactional` methods via `this` — Spring proxy won't intercept it

## Security (Spring Security 6)

```kotlin
@Configuration
@EnableWebSecurity
class SecurityConfig {
  @Bean
  fun securityFilterChain(http: HttpSecurity): SecurityFilterChain = http
    .csrf { it.disable() }           // stateless JWT API
    .sessionManagement { it.sessionCreationPolicy(STATELESS) }
    .authorizeHttpRequests {
      it.requestMatchers("/api/auth/**").permitAll()
        .anyRequest().authenticated()
    }
    .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter::class.java)
    .build()
}
```

- JWT for stateless APIs; sessions for web apps with CSRF
- `@PreAuthorize("hasRole('ADMIN')")` for method-level authorization
- Never log authentication credentials or tokens

## Testing

```kotlin
@SpringBootTest(webEnvironment = RANDOM_PORT)
@AutoConfigureTestDatabase(replace = NONE)    // use Testcontainers
class ItemControllerIT(@Autowired val restTemplate: TestRestTemplate) {

  @Test
  fun `POST items creates and returns 201`() {
    val resp = restTemplate.postForEntity("/api/items",
      CreateItemRequest(title = "Test"), ItemDto::class.java)
    assertEquals(HttpStatus.CREATED, resp.statusCode)
  }
}
```

- `@WebMvcTest` for controller-only tests (fast, no DB)
- `@DataJpaTest` for repository tests against a real embedded or Testcontainers DB
- `@SpringBootTest` for integration tests — use Testcontainers for realistic DB
- `MockMvc` + `@AutoConfigureMockMvc` for HTTP-layer testing without a real port

## Performance

- Connection pool: `HikariCP` (default) — tune `maximumPoolSize` based on load testing
- N+1 queries: use `JOIN FETCH` or `@EntityGraph`; verify with `spring.jpa.show-sql=true` in dev
- Caching: `@Cacheable` + Spring Cache with Redis (`spring-boot-starter-data-redis`)
- Async: `@EnableAsync` + `@Async` on service methods for fire-and-forget; use `CompletableFuture<T>` return type
- Virtual threads (Spring Boot 3.2+): `spring.threads.virtual.enabled=true` for high-concurrency blocking I/O

## Common Pitfalls

- `LazyInitializationException` after transaction closes — resolve with `JOIN FETCH` or DTO projection
- `@Transactional` on private methods — Spring AOP proxy can't intercept; move to public
- Bean cycle injection — restructure or use `@Lazy`
- Returning JPA entities directly from controllers — exposes internal model; always map to DTOs
- `findAll()` without pagination on large tables — always use `Pageable`
