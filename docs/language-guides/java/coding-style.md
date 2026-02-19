# Java Coding Style

## Version and Tooling

- Java 21+ (use records, sealed classes, pattern matching, virtual threads)
- Spring Boot 3.x
- Maven or Gradle (prefer Gradle with Kotlin DSL)
- Checkstyle + Spotbugs + PMD for static analysis
- JUnit 5 + Mockito + AssertJ for testing

## Modern Java Features

```java
// ✅ Records for immutable data transfer objects
public record UserDto(String id, String email, String name) {}

// ✅ Sealed classes for algebraic types
public sealed interface Result<T> permits Result.Success, Result.Failure {
    record Success<T>(T value) implements Result<T> {}
    record Failure<T>(String error) implements Result<T> {}
}

// ✅ Pattern matching with switch
String describe(Object obj) {
    return switch (obj) {
        case Integer i -> "integer: " + i;
        case String s when s.isEmpty() -> "empty string";
        case String s -> "string: " + s;
        default -> "unknown";
    };
}

// ✅ Text blocks for SQL/JSON
String query = """
    SELECT u.id, u.email
    FROM users u
    WHERE u.active = true
    ORDER BY u.created_at DESC
    """;
```

## Spring Injection (constructor only)

```java
// ✅ Constructor injection — testable, immutable
@Service
public class UserService {
    private final UserRepository userRepository;
    private final EmailService emailService;

    public UserService(UserRepository userRepository, EmailService emailService) {
        this.userRepository = userRepository;
        this.emailService = emailService;
    }
}

// ❌ Field injection — not testable without Spring container
@Autowired
private UserRepository userRepository;
```

## Null Safety

```java
// ✅ Optional for nullable returns
public Optional<User> findById(String id) {
    return userRepository.findById(id);
}

// Usage
userService.findById(id)
    .map(UserDto::fromUser)
    .orElseThrow(() -> new UserNotFoundException(id));

// ✅ @NonNull annotations
public User createUser(@NonNull CreateUserRequest request) { ... }
```

## Naming

- Classes/interfaces: `PascalCase`
- Methods/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Packages: `com.company.project.module`
