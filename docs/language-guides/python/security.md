# Python Security

## SQL Injection Prevention

```python
# ❌ String formatting — SQL injection
query = f"SELECT * FROM users WHERE email = '{email}'"
cursor.execute(query)

# ✅ Parameterized queries always
cursor.execute("SELECT * FROM users WHERE email = %s", (email,))

# ✅ SQLAlchemy ORM
user = session.query(User).filter(User.email == email).first()
```

## Input Validation with Pydantic

```python
from pydantic import BaseModel, field_validator

class UserInput(BaseModel):
    name: str
    email: str

    @field_validator("name")
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()
```

## Secret Management

```python
# ✅ Load from environment
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.environ["OPENAI_API_KEY"]  # raises KeyError if missing

# ✅ pydantic-settings for validated config
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    openai_api_key: str
    database_url: str
    debug: bool = False

settings = Settings()  # validates at startup
```

## Dependency Security

```bash
# Audit with safety
pip install safety
safety check

# Or with pip-audit
pip-audit
```

## Command Injection

```python
import subprocess

# ❌ Shell injection
subprocess.run(f"git commit -m '{message}'", shell=True)

# ✅ List args, no shell
subprocess.run(["git", "commit", "-m", message], check=True)
```
