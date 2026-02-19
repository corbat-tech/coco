# Python Coding Style

## Version and Tooling

- Python 3.11+ (prefer 3.12)
- Type hints everywhere
- `ruff` for linting + formatting (replaces flake8 + black + isort)
- `mypy` for static type checking (strict mode)
- `uv` or `pip` with `pyproject.toml`

## Type Hints

```python
# ✅ Always annotate function signatures
def process_user(user_id: str, active: bool = True) -> dict[str, Any]:
    ...

# ✅ Use modern union syntax (Python 3.10+)
def find_user(id: str) -> User | None:
    ...

# ✅ Use TypeAlias for complex types
type UserId = str
type UserDict = dict[str, str | int | bool]

# ❌ No bare functions without types
def process(data):
    ...
```

## Data Classes and Pydantic

```python
# ✅ Pydantic for validated data (API models, config)
from pydantic import BaseModel, Field, EmailStr

class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=0, le=150)

# ✅ Dataclasses for internal data structures
from dataclasses import dataclass, field

@dataclass(frozen=True)
class QualityScore:
    overall: float
    dimensions: dict[str, float] = field(default_factory=dict)
```

## Error Handling

```python
# ❌ Never bare except
try:
    result = risky_operation()
except:
    pass  # swallows everything

# ✅ Specific exceptions with context
try:
    result = risky_operation()
except ValueError as e:
    logger.error("Invalid value: %s", e)
    raise
except IOError as e:
    return {"success": False, "error": str(e)}
```

## Naming

- Classes: `PascalCase`
- Functions/variables: `snake_case`
- Constants: `UPPER_SNAKE_CASE`
- Private: `_leading_underscore`
- Files: `snake_case.py`

## Async (FastAPI/asyncio)

```python
# ✅ Async all the way for I/O-bound work
async def fetch_user(user_id: str) -> User | None:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"/users/{user_id}")
        return User.model_validate(response.json())

# ✅ Gather for parallel operations
users, posts = await asyncio.gather(
    get_user(user_id),
    get_posts(user_id),
)
```
