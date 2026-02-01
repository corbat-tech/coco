# Corbat-Coco: Agent Evaluation and Practical Tutorial

> Comprehensive analysis of the AI agent following OpenClaw best practices, with practical tutorial for Java/Spring Boot developers.

---

## Table of Contents

1. [Agent Evaluation](#1-agent-evaluation)
2. [Scoring by Dimensions](#2-scoring-by-dimensions)
3. [Practical Tutorial: Java/Spring Boot](#3-practical-tutorial-javaspring-boot)
4. [Real Flow Simulations](#4-real-flow-simulations)
5. [Common Use Cases](#5-common-use-cases)
6. [Interaction Patterns](#6-interaction-patterns)

---

## 1. Agent Evaluation

### 1.1 Executive Summary

**Corbat-Coco** is an autonomous coding agent that transforms natural language requirements into production-ready code through an iterative self-review cycle. Unlike other agents like Claude Code or Cursor, it implements a quality convergence system that guarantees senior-level standards.

### 1.2 Core Philosophy

```
"Every line of code must be worthy of a senior engineer's signature."
```

The agent prioritizes **quality over speed**: it prefers iterating 10 times over delivering mediocre code.

---

## 2. Scoring by Dimensions

### Evaluation following OpenClaw criteria

| Dimension | Score | Justification |
|-----------|:-----:|---------------|
| **Architecture** | 9.5/10 | COCO architecture in 4 well-defined phases. Clear separation of responsibilities. Use of state machine for transitions. |
| **Autonomy** | 9/10 | Autonomous iteration loop until convergence. Automatic problem detection. Minimal human intervention required. |
| **Resilience** | 9/10 | Checkpoint system every 5 min. Recovery from interruptions. Rollback to previous versions. |
| **Observability** | 8.5/10 | Complete version history. Scores by dimension. Detailed logs. Missing visual dashboards. |
| **Output Quality** | 9.5/10 | 11-dimension quality system. Minimum threshold 85/100. 100% security mandatory. |
| **Extensibility** | 8/10 | Modular tool registry. Interchangeable LLM providers. Configurable stack profiles. |
| **Transparency** | 9/10 | ADRs for decisions. Reasoning in each iteration. Change history with diffs. |
| **Usability** | 8/10 | Intuitive CLI with clack/prompts. Simple commands. Missing GUIs and docs for beginners. |
| **Security** | 9/10 | 100% mandatory security score. Execution sandbox. API keys in env vars. |
| **TDD/Testing** | 9/10 | Tests generated with code. Minimum 80% coverage. Test quality as a dimension. |

### Global Score: **8.85/10**

---

### 2.1 Detailed Analysis by Dimension

#### Architecture (9.5/10)

**Strengths:**
- Clear and well-defined COCO methodology (Converge -> Orchestrate -> Complete -> Output)
- State machine for phase management with explicit transitions
- Layered separation: CLI -> Orchestrator -> Phases -> Tools -> Providers
- Decoupled persistence from core

**Areas for improvement:**
- Could benefit from event sourcing for better traceability

#### Autonomy (9/10)

**Strengths:**
- Fully autonomous iteration loop
- Convergence based on objective metrics (delta < 2)
- Self-review with issue analysis and suggestions
- Maximum of 10 iterations as safeguard

**Areas for improvement:**
- Could escalate to human before max_iterations if oscillating

#### Quality System (9.5/10)

**Strengths:**
- 11 weighted dimensions covering all aspects
- Differentiated thresholds: minimum (85) vs target (95)
- Security as blocking gate (100% required)
- Convergence detection avoids infinite loops

**Convergence formula:**
```
STOP when:
  Score >= 85 AND
  |Score[n] - Score[n-1]| < 2 AND
  iterations >= 2
```

---

## 3. Practical Tutorial: Java/Spring Boot

### 3.1 Scenario

You are a Java backend developer and want to create a **user management microservice** with:
- User CRUD
- JWT authentication
- Roles and permissions
- Documented REST API
- Integration tests

### 3.2 Installation and Setup

```bash
# 1. Install Corbat-Coco
npm install -g corbat-coco

# 2. Configure API key
export ANTHROPIC_API_KEY="sk-ant-..."

# 3. Create project directory
mkdir user-service && cd user-service

# 4. Initialize project with Corbat-Coco
coco init .
```

### 3.3 CONVERGE Phase: Requirements Definition

When you run `coco init`, the agent starts a discovery session:

```
$ coco init .

Welcome to Corbat-Coco!

Let's create something amazing together.

? What would you like to build?
> A user management microservice with JWT authentication,
  complete CRUD, roles and permissions. Stack: Java 21 + Spring Boot 3.

? Tell me more about the features you need:
> - User registration with email/password
> - Login that returns JWT
> - Refresh tokens
> - Roles: ADMIN, USER, GUEST
> - Endpoints protected by role
> - Action auditing

? What database do you prefer?
> PostgreSQL with Flyway for migrations

? Any specific security requirements?
> - Passwords hashed with BCrypt
> - JWT expires in 1 hour
> - Refresh token expires in 7 days
> - Rate limiting on login (5 attempts per minute)

? Deployment requirements?
> Docker + Kubernetes with GitHub Actions for CI/CD
```

**What the agent does internally:**

1. **Parses** your responses into structured requirements
2. **Classifies** into functional and non-functional
3. **Generates** user stories automatically
4. **Creates** acceptance criteria
5. **Persists** in `.coco/spec/spec.md`

### 3.4 ORCHESTRATE Phase: Architecture and Planning

```
$ coco plan

Analyzing requirements and designing architecture...

+--------------------------------------------------------------+
|                    ARCHITECTURE DECISIONS                     |
+--------------------------------------------------------------+
|                                                               |
|  ADR-001: Hexagonal Architecture                              |
|  - Ports & Adapters for testability                          |
|  - Domain layer independent of frameworks                     |
|                                                               |
|  ADR-002: Spring Boot 3.2 + Java 21                          |
|  - Virtual threads for concurrency                           |
|  - Native compilation ready                                   |
|                                                               |
|  ADR-003: JWT with Refresh Tokens                            |
|  - Access token: 1h expiry, signed RS256                     |
|  - Refresh token: 7d expiry, stored in DB                    |
|                                                               |
|  ADR-004: PostgreSQL + Flyway                                |
|  - Versioned migrations                                       |
|  - Testcontainers for tests                                  |
|                                                               |
+--------------------------------------------------------------+

Generated backlog:

Epic 1: User Management (Priority: 1)
- Story 1.1: User Registration (5 pts)
  - Task: Create User entity and repository
  - Task: Implement registration endpoint
  - Task: Add email validation
  - Task: Write integration tests
- Story 1.2: User Authentication (8 pts)
  - Task: Implement JWT service
  - Task: Create login endpoint
  - Task: Add refresh token logic
  - Task: Write security tests
- Story 1.3: User CRUD (3 pts)
  - Task: Implement CRUD endpoints
  - Task: Add pagination and filtering

Epic 2: Authorization (Priority: 2)
- Story 2.1: Role Management (5 pts)
- Story 2.2: Permission Checks (3 pts)

Sprint 0: Foundation
- 4 tasks, estimated complexity: moderate

? Ready to start building? [Y/n]
```

### 3.5 COMPLETE Phase: Execution with Iteration

```
$ coco build

Starting Sprint 0: Foundation

================================================================

Task 1/4: Create User entity and migrations

  Iteration 1:
  - Generating code... 100%
    Created:
    - src/main/java/com/example/domain/User.java
    - src/main/java/com/example/domain/Role.java
    - src/main/java/com/example/repository/UserRepository.java
    - src/main/resources/db/migration/V1__create_users.sql

  - Running tests...
    - 8 tests passed, 2 failed
      - UserRepositoryTest.findByEmail: NullPointerException
      - UserEntityTest.passwordHash: Assertion failed

  - Quality Evaluation:
    - Overall: 72/100 (warning)
    - Correctness: 65 (tests failing)
    - Test Coverage: 78%
    - Security: 100 (passed)
    - Issues found:
      - [CRITICAL] BCrypt not applied in entity
      - [MAJOR] Missing null check in repository

  - Status: NEEDS IMPROVEMENT (score < 85)

  Iteration 2:
  - Analyzing issues...
    - Identified root causes:
      1. Password not being hashed on entity creation
      2. Repository assuming non-null email

  - Applying improvements:
    - Added @PrePersist hook for password hashing
    - Added Optional<User> for findByEmail
    - Updated tests to match new behavior

  - Running tests...
    - 10 tests passed (checkmark)

  - Quality Evaluation:
    - Overall: 88/100 (passed)
    - Correctness: 95
    - Test Coverage: 92%
    - Security: 100 (passed)
    - Delta from v1: +16 points

  - Status: CONVERGING (score >= 85, checking delta)

  Iteration 3:
  - Minor refinements:
    - Added Javadoc to public methods
    - Improved error messages
    - Added @Valid annotations

  - Quality Evaluation:
    - Overall: 91/100 (passed)
    - Delta from v2: +3 points
    - Convergence check: |91-88| = 3 (threshold: 2)

  - Status: ALMOST CONVERGED (delta slightly above threshold)

  Iteration 4:
  - Final polish:
    - Fixed one edge case in validation

  - Quality Evaluation:
    - Overall: 92/100 (passed)
    - Delta from v3: +1 point
    - Convergence check: |92-91| = 1 < 2 (passed)

  - CONVERGED after 4 iterations

================================================================

Task 2/4: Implement JWT service
  ...continues...
```

---

## 4. Real Flow Simulations

### 4.1 Flow: Task Fails and Needs Multiple Iterations

```
Task: Implement rate limiting for login endpoint

Iteration 1:
- Generated: RateLimitFilter.java using Bucket4j
- Tests: 5 passed, 3 failed
  - Failures:
    - shouldBlockAfter5Attempts: timeout (Redis not mocked)
    - shouldResetAfterWindow: assertion failed
    - shouldAllowDifferentIPs: NullPointerException
- Score: 58/100 (warning)
- Issues:
  - [CRITICAL] Redis dependency not isolated in tests
  - [CRITICAL] Window calculation off by 1
  - [MAJOR] IP extraction fails for proxied requests

Iteration 2:
- Applied improvements:
  - Added @MockBean for RedisTemplate
  - Fixed window calculation (Instant.now vs epoch)
  - Added X-Forwarded-For header parsing
- Tests: 8 passed (checkmark)
- Score: 79/100
- Issues:
  - [MINOR] Missing Javadoc on public methods

Iteration 3:
- Applied improvements:
  - Added comprehensive Javadoc
  - Added integration test with Testcontainers Redis
  - Added OpenAPI annotations
- Tests: 12 passed (checkmark)
- Score: 89/100
- Delta: +10 (not yet converged)

Iteration 4:
- Fine-tuning:
  - Added rate limit headers (X-RateLimit-Remaining)
- Score: 91/100
- Delta: +2 (at threshold)

Iteration 5:
- Final review (no code changes needed)
- Score: 91/100
- Delta: 0 < 2 (checkmark) CONVERGED
```

### 4.2 Flow: Agent Asks for Clarification

```
Task: Implement user deletion endpoint

Agent detected ambiguity:

  "The specification mentions 'user deletion' but doesn't clarify:

  1. Soft delete (mark as deleted, keep data) or hard delete?
  2. Should cascade to related entities (orders, comments)?
  3. Admin-only or self-deletion allowed?
  4. GDPR compliance needed (data export before delete)?

  Please clarify these points."

User response:
> Soft delete with `deleted_at` flag. Only admin can delete.
> Cascade to sessions (forced logout). No GDPR for now.

Agent continues:
- Updated specification with clarifications
- Generated soft delete implementation
- Added admin-only @PreAuthorize annotation
- Created SessionInvalidationService
```

### 4.3 Flow: Rollback Due to Regression

```
Task: Refactor UserService for better testability

Iteration 1:
- Extracted interface IUserService
- Moved to constructor injection
- Score: 85/100 (checkmark)
- All existing tests pass (checkmark)

(warning) Post-iteration validation detected regression:

  Integration test `AuthControllerIT.loginFlow` FAILED
  - Caused by: Bean 'userService' not found
    - Root cause: Forgot to add @Primary to implementation

Agent action:
- Rolling back to previous version (v0)
- Analyzing root cause
- Will retry with @Primary annotation

Iteration 2 (after rollback):
- Applied @Primary to UserServiceImpl
- Added explicit @Qualifier where needed
- Score: 88/100 (checkmark)
- All tests pass including integration (checkmark)
```

### 4.4 Flow: Interruption and Recovery

```
$ coco build

Task 3/8: Implement permission checker...

  Iteration 2: Running tests...

^C  [Interrupted by user]

Saving checkpoint...
- State saved to .coco/checkpoints/cp-2024-01-15-143022.json
- Current task progress preserved
- Files written are safe (atomic writes)

$ coco resume

Found checkpoint from 2 minutes ago

  Resume options:
  1. Continue from last checkpoint (recommended)
  2. Restart current task
  3. Skip to next task

? Select option: [1]

Resuming Task 3/8: Implement permission checker
- Restored iteration 2 state
- Re-running tests from where we left off...
- Continuing normally
```

---

## 5. Common Use Cases

### 5.1 Case: Create a New Microservice From Scratch

```bash
coco init order-service

# Discovery questions:
# - What operations? Order CRUD, states, payments
# - Integrations? External payment service, inventory
# - Events? Publish to Kafka when order changes state
# - Persistence? MongoDB for schema flexibility

coco plan    # Generates hexagonal architecture, ADRs, backlog
coco build   # Builds sprint by sprint with quality
```

**Generated output:**
```
order-service/
├── src/main/java/com/example/
│   ├── domain/           # Entities, Value Objects
│   ├── application/      # Use cases, ports
│   ├── infrastructure/   # Adapters (MongoDB, Kafka, REST)
│   └── config/           # Spring configuration
├── src/test/java/        # Unit + Integration tests
├── src/main/resources/
│   ├── application.yml
│   └── application-test.yml
├── Dockerfile
├── docker-compose.yml
├── .github/workflows/ci.yml
└── README.md
```

### 5.2 Case: Add Feature to Existing Project

```bash
cd existing-project
coco init . --skip-discovery  # Uses existing code as context

# The agent analyzes:
# - Project structure
# - Patterns in use
# - Existing tests
# - Dependencies

coco plan --feature "Add user notification preferences"

# Generates:
# - New entities (NotificationPreference)
# - REST endpoints
# - Tests following existing patterns
# - DB migration

coco build --sprint=0  # Only the new feature
```

### 5.3 Case: Legacy Code Refactoring

```bash
coco init legacy-app --mode=refactor

# The agent:
# 1. Analyzes existing code
# 2. Identifies code smells
# 3. Proposes refactoring plan
# 4. Adds tests BEFORE refactoring
# 5. Refactors incrementally
# 6. Validates that tests still pass

? Detected issues in codebase:
  - God class: UserController (1,847 lines)
  - Missing tests: PaymentService (0% coverage)
  - Circular dependency: OrderService <-> InventoryService
  - Hardcoded configs: DatabaseConfig

? Suggested refactoring plan:
  Sprint 1: Add tests to critical paths (no code changes)
  Sprint 2: Extract UserController into smaller controllers
  Sprint 3: Break circular dependency with events
  Sprint 4: Externalize configuration

? Accept plan and start? [Y/n]
```

### 5.4 Case: Bug Fix with Root Cause Analysis

```bash
coco fix "Users report 500 error when updating profile with emoji"

# The agent:
# 1. Reproduces the bug (finds the failing test)
# 2. Analyzes stack traces
# 3. Identifies root cause
# 4. Proposes fix
# 5. Adds regression test
# 6. Applies fix with quality

Root Cause Analysis:

  Error: DataTruncation: Data too long for column 'bio'

  Investigation:
  - Column 'bio' defined as VARCHAR(255)
  - Emoji characters use 4 bytes (utf8mb4)
  - 255 chars with emoji = up to 1020 bytes
  - MySQL VARCHAR(255) in utf8 = 765 bytes max

  Solution:
  - Migrate column to TEXT
  - OR increase to VARCHAR(500) with utf8mb4
  - Add validation on input (max 200 chars displayed)

  Generating fix...
```

---

## 6. Interaction Patterns

### 6.1 How to Ask Things from the Agent (Best Practices)

#### DO: Be specific with technical requirements

```
GOOD:
"Create REST endpoint POST /api/users that:
- Validates unique email
- Hashes password with BCrypt (strength 12)
- Returns 201 with Location header
- Returns 409 if email duplicated"

BAD:
"Create endpoint to register users"
```

#### DO: Specify quality constraints

```
GOOD:
"Implement with:
- Minimum 90% coverage
- OpenAPI documentation
- Structured logs (JSON)
- Micrometer metrics"

BAD:
"Make it well tested"
```

#### DO: Give integration context

```
GOOD:
"This service will be called by:
- API Gateway (authentication already validated)
- Internal cron job (no auth, IP whitelist)
- Another microservice via Feign (mTLS)"

BAD:
"It's for a microservice"
```

### 6.2 What to Expect from the Agent

| Action | The Agent Will | The Agent Will NOT |
|--------|----------------|-------------------|
| **Code** | Generate clean, tested, documented code | Generate code without tests |
| **Tests** | TDD, edge cases, happy path, error cases | Trivial tests or mocking everything |
| **Errors** | Analyze, propose fix, iterate | Ignore errors or do workarounds |
| **Doubts** | Ask for clarification | Assume without validating |
| **Decisions** | Document in ADRs with alternatives | Make silent decisions |
| **Progress** | Checkpoints, versions, metrics | Work without traceability |

### 6.3 Most Used Commands

```bash
# Initialization
coco init [path]              # New project
coco init . --skip-discovery  # On existing project

# Planning
coco plan                     # Discovery + Architecture
coco plan --auto              # Without confirmations

# Building
coco build                    # Execute sprints
coco build --sprint=2         # Specific sprint
coco build --max-iterations=5 # Limit iterations

# Status and Recovery
coco status                   # View progress
coco status --verbose         # With details
coco resume                   # Continue after interruption
coco resume --from-checkpoint=<id>

# Config
coco config set quality.minScore 90
coco config set provider.model claude-opus-4-20250514
```

---

## 7. Evaluation Summary

### 7.1 Final Score

| Category | Weight | Score | Weighted |
|----------|:------:|:-----:|:--------:|
| Architecture | 15% | 9.5 | 1.43 |
| Autonomy | 15% | 9.0 | 1.35 |
| Output Quality | 20% | 9.5 | 1.90 |
| Resilience | 10% | 9.0 | 0.90 |
| Observability | 10% | 8.5 | 0.85 |
| Extensibility | 10% | 8.0 | 0.80 |
| Transparency | 10% | 9.0 | 0.90 |
| Usability | 10% | 8.0 | 0.80 |
| **TOTAL** | **100%** | | **8.93/10** |

### 7.2 Verdict

**Corbat-Coco is an enterprise-level coding agent** that stands out for:

1. **Robust quality system** with 11 dimensions and convergence
2. **Real autonomy** with minimal human intervention
3. **Exceptional resilience** with checkpoints and recovery
4. **Total transparency** in decisions and progress

**Ideal for:**
- Teams that prioritize quality over speed
- Greenfield projects with clear requirements
- Legacy code refactoring with safety nets
- Organizations with strict code standards

**Not ideal for:**
- Quick prototypes without quality requirements
- Projects with extreme time constraints
- Cases where fine manual control is needed

---

## Appendix: Complete Session Example

```bash
# Complete terminal session

$ mkdir user-service && cd user-service
$ coco init .

Welcome to Corbat-Coco!

? What would you like to build?
> User microservice with Java 21 + Spring Boot 3.2

? Tech stack preferences?
> PostgreSQL, JWT auth, Hexagonal architecture

? Deployment target?
> Docker + K8s, CI/CD with GitHub Actions

Specification generated: .coco/spec/spec.md

$ coco plan

Designing architecture...

Created:
- ADR-001: Hexagonal Architecture
- ADR-002: Spring Boot 3.2 + Java 21
- ADR-003: JWT Authentication
- ADR-004: PostgreSQL + Flyway

Backlog: 2 epics, 6 stories, 24 tasks

? Start building? [Y/n] Y

$ coco build

Sprint 0: Foundation
- Task 1/6: Create User entity (checkmark) (3 iterations, score: 92)
- Task 2/6: Implement repository (checkmark) (2 iterations, score: 89)
- Task 3/6: Create JWT service (checkmark) (4 iterations, score: 91)
- Task 4/6: Auth controller (checkmark) (3 iterations, score: 88)
- Task 5/6: Rate limiting (checkmark) (5 iterations, score: 90)
- Task 6/6: Integration tests (checkmark) (2 iterations, score: 94)

Sprint Complete!
- 6/6 tasks completed
- Average quality: 90.7/100
- Test coverage: 89%
- Security issues: 0

Continue to Sprint 1? [Y/n]
```

---

**Document generated:** 2024
**Version:** 1.0.0
**Author:** Analysis based on Corbat-Coco architecture
