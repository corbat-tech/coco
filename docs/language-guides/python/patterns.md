# Python Patterns

## FastAPI Patterns

```python
from fastapi import FastAPI, Depends, HTTPException, status
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db.connect()
    yield
    # Shutdown
    await db.disconnect()

app = FastAPI(lifespan=lifespan)

# Dependency injection
async def get_db() -> AsyncGenerator[Database, None]:
    async with Database() as db:
        yield db

@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    db: Database = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    user = await db.users.find_one(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return UserResponse.model_validate(user)
```

## Repository Pattern (Python)

```python
from abc import ABC, abstractmethod

class UserRepository(ABC):
    @abstractmethod
    async def find_by_id(self, id: str) -> User | None: ...

    @abstractmethod
    async def create(self, data: CreateUserDto) -> User: ...

class PostgresUserRepository(UserRepository):
    def __init__(self, db: Database):
        self.db = db

    async def find_by_id(self, id: str) -> User | None:
        row = await self.db.fetchrow("SELECT * FROM users WHERE id = $1", id)
        return User(**row) if row else None
```

## Async Context Managers

```python
# ✅ Use for resource management
class RedisCache:
    async def __aenter__(self):
        self.client = await aioredis.create_redis_pool(REDIS_URL)
        return self

    async def __aexit__(self, *args):
        self.client.close()
        await self.client.wait_closed()

async with RedisCache() as cache:
    await cache.set("key", "value")
```

## Enum for Constants

```python
from enum import StrEnum, auto

class UserRole(StrEnum):
    ADMIN = auto()
    USER = auto()
    GUEST = auto()

# Usage
if user.role == UserRole.ADMIN:
    ...
```
