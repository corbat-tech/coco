# Python Testing

## Framework

- **pytest** with `pytest-asyncio` for async tests
- **coverage.py** — target 80%+
- `pytest-mock` for mocking

## Structure

```
tests/
├── unit/          # pure unit tests, no I/O
│   └── test_service.py
├── integration/   # database, external services
│   └── test_api.py
└── e2e/           # full user flows
    └── test_user_flow.py
```

## Test Template

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

@pytest.fixture
def mock_db():
    return AsyncMock()

@pytest.fixture
def user_service(mock_db):
    return UserService(db=mock_db)

class TestUserService:
    async def test_create_user_success(self, user_service, mock_db):
        mock_db.find_by_email.return_value = None
        mock_db.create.return_value = User(id="1", email="test@example.com")

        result = await user_service.create_user(
            CreateUserRequest(email="test@example.com", name="Test")
        )

        assert result.id == "1"
        mock_db.create.assert_called_once()

    async def test_create_user_duplicate_email(self, user_service, mock_db):
        mock_db.find_by_email.return_value = User(id="existing")

        with pytest.raises(ConflictError, match="Email already exists"):
            await user_service.create_user(
                CreateUserRequest(email="test@example.com", name="Test")
            )
```

## Run Tests

```bash
pytest                          # all tests
pytest tests/unit/              # unit only
pytest --cov=src --cov-report=term-missing  # with coverage
pytest -x                       # stop on first failure
pytest -k "test_create"         # run matching tests
```

## Coverage

```bash
pytest --cov=src --cov-report=html --cov-fail-under=80
```
