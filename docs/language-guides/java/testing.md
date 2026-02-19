# Java Testing (JUnit 5 + Spring Boot)

## Framework

- JUnit 5 (`@Test`, `@ParameterizedTest`, `@BeforeEach`)
- Mockito for mocks
- AssertJ for fluent assertions
- Spring Boot Test for integration tests
- Testcontainers for database tests

## Unit Test Structure

```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private EmailService emailService;

    @InjectMocks
    private UserService userService;

    @BeforeEach
    void setUp() {
        // common setup
    }

    @Test
    @DisplayName("createUser: returns created user for valid request")
    void createUser_validRequest_returnsUser() {
        // Arrange
        var request = new CreateUserRequest("test@example.com", "Test User");
        var savedUser = new User("1", "test@example.com", "Test User");
        when(userRepository.existsByEmail("test@example.com")).thenReturn(false);
        when(userRepository.save(any())).thenReturn(savedUser);

        // Act
        var result = userService.createUser(request);

        // Assert
        assertThat(result.id()).isEqualTo("1");
        assertThat(result.email()).isEqualTo("test@example.com");
        verify(emailService).sendWelcomeEmail("test@example.com");
    }

    @Test
    @DisplayName("createUser: throws ConflictException for duplicate email")
    void createUser_duplicateEmail_throwsConflict() {
        when(userRepository.existsByEmail(any())).thenReturn(true);

        assertThatThrownBy(() -> userService.createUser(new CreateUserRequest("dup@test.com", "Dup")))
            .isInstanceOf(ConflictException.class)
            .hasMessageContaining("Email already exists");
    }
}
```

## Integration Tests (Spring Boot)

```java
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class UserControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void getUser_existingId_returns200() throws Exception {
        mockMvc.perform(get("/api/v1/users/1")
                .header("Authorization", "Bearer " + validToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value("test@example.com"));
    }
}
```

## Coverage

```bash
./mvnw test jacoco:report
# target: 80%+ line/branch coverage
```

Target: 80%+ across all modules.
