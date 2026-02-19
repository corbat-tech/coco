# Go Architecture Patterns

## Standard Project Layout

```
cmd/
├── api/main.go         # API server entry point
└── worker/main.go      # Background worker entry point
internal/
├── domain/
│   ├── user.go         # Domain model
│   └── errors.go       # Domain errors
├── service/
│   └── user_service.go # Business logic
├── repository/
│   ├── interface.go    # Repository interfaces
│   └── postgres/       # PostgreSQL implementation
└── handler/
    └── user_handler.go # HTTP handlers
pkg/
└── middleware/         # Reusable middleware
```

## Interface-Driven Design

```go
// Define interfaces where you consume, not where you implement
// internal/service/user_service.go
type UserRepository interface {
    FindByID(ctx context.Context, id string) (*domain.User, error)
    Create(ctx context.Context, user *domain.User) error
}

type UserService struct {
    repo   UserRepository    // interface, not concrete type
    logger *slog.Logger
}

func NewUserService(repo UserRepository, logger *slog.Logger) *UserService {
    return &UserService{repo: repo, logger: logger}
}
```

## Structured Logging (slog — Go 1.21+)

```go
// ✅ Use slog for structured logs
logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

logger.InfoContext(ctx, "user created",
    slog.String("user_id", user.ID),
    slog.String("email", user.Email),
)

logger.ErrorContext(ctx, "failed to create user",
    slog.String("error", err.Error()),
    slog.Any("request", req),
)
```

## Middleware Pattern (net/http)

```go
type Middleware func(http.Handler) http.Handler

func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if !isValidToken(token) {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

## Functional Options

```go
type ServerOptions struct {
    port    int
    timeout time.Duration
}

type Option func(*ServerOptions)

func WithPort(port int) Option {
    return func(o *ServerOptions) { o.port = port }
}

func NewServer(opts ...Option) *Server {
    o := &ServerOptions{port: 8080, timeout: 30 * time.Second}
    for _, opt := range opts {
        opt(o)
    }
    return &Server{options: o}
}
```

## Graceful Shutdown

```go
server := &http.Server{Addr: ":8080", Handler: router}

go func() {
    if err := server.ListenAndServe(); err != http.ErrServerClosed {
        log.Fatal(err)
    }
}()

quit := make(chan os.Signal, 1)
signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
<-quit

ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
server.Shutdown(ctx)
```
