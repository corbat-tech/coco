# Go Coding Style

## Version and Tooling

- Go 1.21+ (with generics, structured logging)
- `golangci-lint` for static analysis
- `gofmt` / `goimports` for formatting (enforced)
- `go test ./...` with race detector: `go test -race ./...`
- `govulncheck` for dependency security

## Naming

```go
// ✅ Exported: PascalCase
type UserService struct {}
func CreateUser(req CreateUserRequest) (User, error) {}

// ✅ Unexported: camelCase
type userRepository struct {}
func findByEmail(email string) (*User, error) {}

// ✅ Interfaces end in -er or describe behavior
type UserCreator interface { CreateUser(req CreateUserRequest) (User, error) }
type Storer interface { Store(data []byte) error }

// ✅ Short variable names OK in short scopes
for i, v := range items { ... }
// But not for long-lived variables
```

## Error Handling

```go
// ✅ Always check errors — never _ for errors
result, err := doSomething()
if err != nil {
    return fmt.Errorf("doSomething: %w", err)
}

// ✅ Wrap errors with context
if err := db.QueryRow(query, id).Scan(&user.ID); err != nil {
    return nil, fmt.Errorf("findUser %s: %w", id, err)
}

// ✅ Sentinel errors for expected conditions
var ErrUserNotFound = errors.New("user not found")
var ErrDuplicateEmail = errors.New("email already exists")

// Check with errors.Is
if errors.Is(err, ErrUserNotFound) { ... }
```

## Context

```go
// ✅ context.Context as FIRST parameter for any I/O
func (s *UserService) FindUser(ctx context.Context, id string) (*User, error) {
    return s.repo.FindByID(ctx, id)
}

// ✅ Propagate context, don't store it in structs
```

## No Naked Returns

```go
// ❌ Naked return — confusing
func divide(a, b float64) (result float64, err error) {
    if b == 0 {
        err = errors.New("division by zero")
        return
    }
    result = a / b
    return
}

// ✅ Explicit returns
func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}
```

## Goroutines and Channels

```go
// ✅ Always handle goroutine lifecycle
var wg sync.WaitGroup
for _, item := range items {
    wg.Add(1)
    go func(item Item) {
        defer wg.Done()
        process(item)
    }(item)
}
wg.Wait()

// ✅ Use errgroup for parallel with errors
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item // capture loop variable
    g.Go(func() error {
        return process(ctx, item)
    })
}
if err := g.Wait(); err != nil { ... }
```
