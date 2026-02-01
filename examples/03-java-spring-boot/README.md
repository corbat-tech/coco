# Example: Java Spring Boot Microservice

This example demonstrates using Corbat-Coco to build a production-ready Java microservice.

## What Gets Built

A Spring Boot microservice for order management with:

- **REST API**: Full CRUD for orders
- **Database**: PostgreSQL with Flyway migrations
- **Security**: JWT authentication with Spring Security
- **Validation**: Bean Validation (JSR-380)
- **Documentation**: OpenAPI/Swagger
- **Testing**: JUnit 5 + Testcontainers
- **Observability**: Micrometer metrics, structured logging
- **Docker**: Multi-stage Dockerfile

## Tech Stack

- **Language**: Java 21
- **Framework**: Spring Boot 3.2
- **Database**: PostgreSQL
- **Migration**: Flyway
- **Testing**: JUnit 5, Mockito, Testcontainers
- **Build**: Gradle (Kotlin DSL)
- **Containerization**: Docker

## Prerequisites

1. **Corbat-Coco installed**:
   ```bash
   npm install -g corbat-coco
   ```

2. **Anthropic API key**:
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. **Java 21**:
   ```bash
   java --version  # Should be 21+
   ```

4. **Docker** (for Testcontainers):
   ```bash
   docker --version
   ```

## Quick Start

```bash
# Create new directory
mkdir order-service && cd order-service

# Initialize with Corbat-Coco
coco init .

# When asked, describe what you want:
# "A Spring Boot 3.2 microservice for order management.
#  Java 21, PostgreSQL, JWT auth, Flyway migrations,
#  hexagonal architecture, OpenAPI docs, Testcontainers
#  for integration tests."

# Run planning and build
coco plan
coco build
```

## Configuration

Pre-configured `.coco/config.json`:

```json
{
  "project": {
    "name": "order-service",
    "version": "0.1.0",
    "description": "Order management microservice"
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
    "language": "java",
    "framework": "spring-boot"
  }
}
```

## Expected Output

```
order-service/
├── src/
│   ├── main/
│   │   ├── java/com/example/orderservice/
│   │   │   ├── OrderServiceApplication.java
│   │   │   ├── domain/
│   │   │   │   ├── Order.java
│   │   │   │   ├── OrderStatus.java
│   │   │   │   └── OrderRepository.java
│   │   │   ├── application/
│   │   │   │   ├── OrderService.java
│   │   │   │   └── dto/
│   │   │   ├── infrastructure/
│   │   │   │   ├── persistence/
│   │   │   │   ├── security/
│   │   │   │   └── config/
│   │   │   └── web/
│   │   │       ├── OrderController.java
│   │   │       └── GlobalExceptionHandler.java
│   │   └── resources/
│   │       ├── application.yml
│   │       ├── application-dev.yml
│   │       ├── application-prod.yml
│   │       └── db/migration/
│   │           └── V1__create_orders.sql
│   └── test/
│       └── java/com/example/orderservice/
│           ├── domain/
│           ├── application/
│           ├── web/
│           └── integration/
├── build.gradle.kts
├── settings.gradle.kts
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Generated API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/orders` | Create order |
| GET | `/api/orders` | List orders (paginated) |
| GET | `/api/orders/{id}` | Get order by ID |
| PUT | `/api/orders/{id}` | Update order |
| DELETE | `/api/orders/{id}` | Cancel order |
| POST | `/api/orders/{id}/status` | Update order status |

## Running the Generated Service

```bash
# Build
./gradlew build

# Run tests
./gradlew test

# Start with Docker Compose
docker-compose up -d

# Or run directly
./gradlew bootRun

# Access Swagger UI
open http://localhost:8080/swagger-ui.html
```

## Architecture

The generated code follows **Hexagonal Architecture**:

```
┌─────────────────────────────────────────┐
│              Web Layer                   │
│         (Controllers, DTOs)              │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│          Application Layer               │
│       (Services, Use Cases)              │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│            Domain Layer                  │
│    (Entities, Repositories - Ports)      │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│        Infrastructure Layer              │
│   (JPA Repos, Security, Config)          │
└─────────────────────────────────────────┘
```

## Time Estimate

~30-45 minutes total build time.

Java projects typically take longer due to:
- More boilerplate code
- Comprehensive test setup with Testcontainers
- Multiple configuration profiles
