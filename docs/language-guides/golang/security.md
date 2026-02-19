# Go Security

## SQL Injection

```go
// ❌ String formatting — SQL injection
query := fmt.Sprintf("SELECT * FROM users WHERE email = '%s'", email)
db.Query(query)

// ✅ Parameterized queries
row := db.QueryRowContext(ctx, "SELECT id, email FROM users WHERE email = $1", email)

// ✅ sqlx named queries
rows, err := db.NamedQueryContext(ctx,
    "SELECT * FROM users WHERE email = :email",
    map[string]interface{}{"email": email},
)
```

## Input Validation

```go
// ✅ Validate at API boundary
type CreateUserRequest struct {
    Email string `json:"email" validate:"required,email"`
    Name  string `json:"name" validate:"required,min=1,max=100"`
}

// Using go-playground/validator
validate := validator.New()
if err := validate.Struct(req); err != nil {
    return nil, fmt.Errorf("validation: %w", err)
}
```

## Secret Management

```go
// ✅ Load from environment
apiKey := os.Getenv("OPENAI_API_KEY")
if apiKey == "" {
    log.Fatal("OPENAI_API_KEY not set")
}

// ✅ Use godotenv for development
godotenv.Load()
```

## Command Injection

```go
// ❌ Shell injection
exec.Command("sh", "-c", "git commit -m " + message).Run()

// ✅ Explicit args — no shell interpolation
exec.CommandContext(ctx, "git", "commit", "-m", message).Run()
```

## Dependency Auditing

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

## Crypto

```go
// ❌ Weak hash
import "crypto/md5"
hash := md5.Sum(data)

// ✅ Strong hash
import "crypto/sha256"
hash := sha256.Sum256(data)

// ✅ Password hashing with bcrypt
import "golang.org/x/crypto/bcrypt"
hashed, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
```
