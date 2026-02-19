# Go Testing

## Framework

- Standard `testing` package — no external test framework needed
- `testify` for assertions (optional but recommended)
- `gomock` or `testify/mock` for mocking interfaces
- `httptest` for HTTP handler tests

## Table-Driven Tests

```go
func TestCreateUser(t *testing.T) {
    tests := []struct {
        name    string
        input   CreateUserRequest
        want    User
        wantErr bool
    }{
        {
            name:  "valid request creates user",
            input: CreateUserRequest{Email: "test@example.com", Name: "Test"},
            want:  User{Email: "test@example.com", Name: "Test"},
        },
        {
            name:    "empty email returns error",
            input:   CreateUserRequest{Email: "", Name: "Test"},
            wantErr: true,
        },
        {
            name:    "invalid email format returns error",
            input:   CreateUserRequest{Email: "not-an-email", Name: "Test"},
            wantErr: true,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            svc := NewUserService(NewMockRepository(t))

            got, err := svc.CreateUser(context.Background(), tt.input)

            if tt.wantErr {
                assert.Error(t, err)
                return
            }
            require.NoError(t, err)
            assert.Equal(t, tt.want.Email, got.Email)
        })
    }
}
```

## Mock Interfaces

```go
// Define interface in production code
type UserRepository interface {
    FindByID(ctx context.Context, id string) (*User, error)
    Create(ctx context.Context, user *User) (*User, error)
}

// Generate mock: go generate ./...
//go:generate mockgen -source=repository.go -destination=mock_repository.go -package=mocks

// Use in tests
func TestUserService_FindUser(t *testing.T) {
    ctrl := gomock.NewController(t)
    defer ctrl.Finish()

    mockRepo := mocks.NewMockUserRepository(ctrl)
    mockRepo.EXPECT().
        FindByID(gomock.Any(), "user-1").
        Return(&User{ID: "user-1"}, nil)

    svc := NewUserService(mockRepo)
    user, err := svc.FindUser(context.Background(), "user-1")
    require.NoError(t, err)
    assert.Equal(t, "user-1", user.ID)
}
```

## HTTP Tests

```go
func TestGetUser(t *testing.T) {
    handler := NewUserHandler(mockService)
    server := httptest.NewServer(handler.Routes())
    defer server.Close()

    resp, err := http.Get(server.URL + "/users/1")
    require.NoError(t, err)
    assert.Equal(t, http.StatusOK, resp.StatusCode)
}
```

## Running Tests

```bash
go test ./...                     # all tests
go test -race ./...               # with race detector
go test -cover ./...              # with coverage
go test -coverprofile=coverage.out ./... && go tool cover -html=coverage.out
```

Target: 80%+ coverage.
