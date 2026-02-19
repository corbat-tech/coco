# Java Security (Spring Boot)

## SQL Injection

```java
// ❌ String concatenation — SQL injection
String query = "SELECT * FROM users WHERE email = '" + email + "'";
em.createNativeQuery(query).getResultList();

// ✅ Parameterized queries
@Query("SELECT u FROM User u WHERE u.email = :email")
Optional<User> findByEmail(@Param("email") String email);

// ✅ JPA criteria API
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery<User> query = cb.createQuery(User.class);
// ... parameterized, safe
```

## Input Validation

```java
// ✅ Bean Validation annotations
public record CreateUserRequest(
    @NotBlank @Email String email,
    @NotBlank @Size(min = 1, max = 100) String name,
    @Min(0) @Max(150) int age
) {}

// ✅ Enable validation in controllers
@RestController
@Validated
public class UserController {
    @PostMapping("/users")
    public UserDto createUser(@Valid @RequestBody CreateUserRequest request) { ... }
}
```

## Authentication (Spring Security)

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()
                .anyRequest().authenticated()
            )
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .build();
    }
}
```

## Dependency Security

```bash
./mvnw org.owasp:dependency-check-maven:check
# Fails build if CVSS >= 7
```

Add to `pom.xml`:
```xml
<plugin>
    <groupId>org.owasp</groupId>
    <artifactId>dependency-check-maven</artifactId>
    <configuration>
        <failBuildOnCVSS>7</failBuildOnCVSS>
    </configuration>
</plugin>
```
