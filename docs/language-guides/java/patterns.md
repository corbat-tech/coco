# Java Architecture Patterns (Spring Boot)

## Hexagonal Architecture (Ports & Adapters)

```
src/main/java/com/company/project/
├── domain/
│   ├── model/          # User, Order — pure domain objects
│   ├── service/        # UserService — business logic
│   └── port/
│       ├── in/         # Use case interfaces (driving ports)
│       └── out/        # Repository interfaces (driven ports)
├── application/        # Use case implementations
├── adapter/
│   ├── in/
│   │   └── web/        # REST controllers, GraphQL
│   └── out/
│       └── persistence/ # JPA repositories, Spring Data
└── config/             # Spring configuration
```

## Use Case Pattern

```java
// Port (interface in domain)
public interface CreateUserUseCase {
    UserDto execute(CreateUserCommand command);
}

// Command (input)
public record CreateUserCommand(String email, String name) {}

// Implementation (in application layer)
@Service
@Transactional
public class CreateUserService implements CreateUserUseCase {
    private final UserRepository userRepository; // port, not JPA

    @Override
    public UserDto execute(CreateUserCommand command) {
        // Pure business logic, no infrastructure concerns
        if (userRepository.existsByEmail(command.email())) {
            throw new DuplicateEmailException(command.email());
        }
        var user = User.create(command.email(), command.name());
        return UserDto.fromDomain(userRepository.save(user));
    }
}
```

## Virtual Threads (Java 21+)

```java
// application.properties (Spring Boot 3.2+)
spring.threads.virtual.enabled=true

// Or in code
Executors.newVirtualThreadPerTaskExecutor();
```

## Specification Pattern (complex queries)

```java
public class UserSpecifications {
    public static Specification<User> hasEmail(String email) {
        return (root, query, cb) -> cb.equal(root.get("email"), email);
    }

    public static Specification<User> isActive() {
        return (root, query, cb) -> cb.isTrue(root.get("active"));
    }
}

// Usage
userRepository.findAll(hasEmail(email).and(isActive()));
```
