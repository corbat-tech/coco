# Example: REST API with TypeScript

This example demonstrates using Corbat-Coco to build a complete REST API for a task management system.

## What Gets Built

A production-ready REST API with:

- **CRUD Operations**: Create, Read, Update, Delete tasks
- **User Authentication**: JWT-based auth with refresh tokens
- **Input Validation**: Zod schemas for all inputs
- **Error Handling**: Consistent error responses
- **Database**: PostgreSQL with migrations
- **Tests**: Unit and integration tests (80%+ coverage)
- **Documentation**: OpenAPI/Swagger docs
- **CI/CD**: GitHub Actions workflow

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript
- **Framework**: Express.js or Fastify (your choice)
- **Database**: PostgreSQL
- **ORM**: Drizzle or Prisma
- **Testing**: Vitest
- **Validation**: Zod

## Prerequisites

1. **Corbat-Coco installed**:
   ```bash
   npm install -g corbat-coco
   ```

2. **Anthropic API key**:
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. **PostgreSQL** (optional for full build):
   ```bash
   docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
   ```

## Quick Start

### Option 1: Start Fresh

```bash
# Create new directory
mkdir my-task-api && cd my-task-api

# Initialize with Corbat-Coco
coco init .

# When asked "What would you like to build?", respond:
# "A REST API for task management with user authentication,
#  using TypeScript, Express, PostgreSQL, and JWT auth"

# Run planning phase
coco plan

# Build the project
coco build
```

### Option 2: Use Pre-configured Setup

```bash
# Copy this example
cp -r examples/01-rest-api-typescript my-task-api
cd my-task-api

# The .coco/config.json is already configured
# Skip directly to planning
coco plan

# Build
coco build
```

## Configuration

The `.coco/config.json` is pre-configured:

```json
{
  "project": {
    "name": "task-api",
    "version": "0.1.0",
    "description": "REST API for task management"
  },
  "provider": {
    "type": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "quality": {
    "minScore": 85,
    "minCoverage": 80,
    "maxIterations": 10
  },
  "stack": {
    "language": "typescript",
    "framework": "express"
  }
}
```

## Expected Workflow

### Phase 1: CONVERGE (~2-3 min)

Corbat-Coco will ask clarifying questions:

```
? What authentication method do you prefer?
> JWT with refresh tokens

? What database do you want to use?
> PostgreSQL

? Any specific features for tasks?
> Tasks have title, description, status, due date, priority, and assignee
```

### Phase 2: ORCHESTRATE (~3-5 min)

Generates:
- Architecture document
- ADRs (Architecture Decision Records)
- Backlog with epics, stories, tasks
- Sprint plan

### Phase 3: COMPLETE (~15-30 min)

Builds each task with quality iteration:

```
Sprint 0: Foundation
├─ Task 1: Project setup and configuration ✓
├─ Task 2: Database schema and migrations ✓
├─ Task 3: User entity and authentication ✓
├─ Task 4: Task CRUD endpoints ✓
├─ Task 5: Input validation ✓
└─ Task 6: Error handling middleware ✓

Average quality: 89/100
Test coverage: 87%
```

### Phase 4: OUTPUT (~2-3 min)

Generates:
- Dockerfile
- docker-compose.yml
- GitHub Actions workflow
- README.md
- API documentation

## Expected Output

After completion, your project will have:

```
my-task-api/
├── src/
│   ├── config/           # Configuration
│   ├── controllers/      # Route handlers
│   ├── middleware/       # Auth, validation, errors
│   ├── models/           # Database models
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   ├── types/            # TypeScript types
│   └── index.ts          # Entry point
├── test/
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
├── migrations/           # Database migrations
├── .github/
│   └── workflows/
│       └── ci.yml        # CI/CD pipeline
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── README.md
└── .env.example
```

## API Endpoints

The generated API will include:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login and get tokens |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/tasks` | List all tasks |
| POST | `/tasks` | Create new task |
| GET | `/tasks/:id` | Get task by ID |
| PUT | `/tasks/:id` | Update task |
| DELETE | `/tasks/:id` | Delete task |

## Running the Generated API

```bash
# Install dependencies
pnpm install

# Run migrations
pnpm db:migrate

# Start development server
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build
```

## Quality Report

After each task, you'll see quality metrics:

```
Task: Implement task CRUD endpoints

Quality Score: 91/100
├─ Correctness: 95
├─ Test Coverage: 92%
├─ Security: 100
├─ Readability: 88
└─ Maintainability: 90

Iterations: 3
Status: CONVERGED
```

## Customization

### Change the Framework

Edit `.coco/config.json`:

```json
{
  "stack": {
    "framework": "fastify"  // or "nestjs", "hono"
  }
}
```

### Change Quality Requirements

```json
{
  "quality": {
    "minScore": 90,      // Higher quality bar
    "minCoverage": 85,   // More test coverage
    "maxIterations": 15  // More iterations allowed
  }
}
```

## Troubleshooting

### "API key not found"

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### "Quality score not improving"

The agent will iterate up to `maxIterations` times. If quality plateaus:
- Check the quality report for specific issues
- Consider lowering `minScore` temporarily
- Review the generated code manually

### "Tests failing"

```bash
# Run tests with verbose output
pnpm test -- --reporter=verbose

# Check coverage report
pnpm test:coverage
```

## Time Estimates

| Phase | Time |
|-------|------|
| CONVERGE | 2-3 minutes |
| ORCHESTRATE | 3-5 minutes |
| COMPLETE | 15-30 minutes |
| OUTPUT | 2-3 minutes |
| **Total** | **~25-45 minutes** |

Times vary based on project complexity and number of iterations needed.

## Next Steps

After the API is built:

1. Review the generated code
2. Customize business logic as needed
3. Set up your database
4. Deploy using the generated Docker config
5. Use the CI/CD pipeline for continuous deployment

## Need Help?

- Check the [main documentation](../../docs/)
- Open an [issue](https://github.com/corbat/corbat-coco/issues)
- Review [troubleshooting guide](../../docs/guides/TROUBLESHOOTING.md)
