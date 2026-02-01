/**
 * Docker Generator for the OUTPUT phase
 *
 * Generates Dockerfile and Docker Compose configurations
 */

import type {
  DockerConfig,
  ComposeConfig,
  ProjectMetadata,
} from "./types.js";

/**
 * Docker Generator
 */
export class DockerGenerator {
  private metadata: ProjectMetadata;

  constructor(metadata: ProjectMetadata) {
    this.metadata = metadata;
  }

  /**
   * Generate Dockerfile
   */
  generateDockerfile(config?: Partial<DockerConfig>): string {
    const language = this.metadata.language.toLowerCase();

    switch (language) {
      case "typescript":
      case "javascript":
        return this.generateNodeDockerfile(config);
      case "python":
        return this.generatePythonDockerfile(config);
      case "go":
        return this.generateGoDockerfile(config);
      default:
        return this.generateNodeDockerfile(config);
    }
  }

  /**
   * Generate Node.js Dockerfile (multi-stage)
   */
  private generateNodeDockerfile(config?: Partial<DockerConfig>): string {
    const port = config?.port || 3000;
    const packageManager = this.metadata.packageManager || "npm";

    let installCmd = "npm ci";
    let runInstall = "npm ci --production";

    if (packageManager === "pnpm") {
      installCmd = "pnpm install --frozen-lockfile";
      runInstall = "pnpm install --prod --frozen-lockfile";
    }

    return `# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
${packageManager === "pnpm" ? "COPY pnpm-lock.yaml ./\n" : ""}
# Install dependencies
RUN ${installCmd}

# Copy source
COPY . .

# Build
RUN npm run build

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
${packageManager === "pnpm" ? "COPY pnpm-lock.yaml ./\n" : ""}
# Install production dependencies only
RUN ${runInstall}

# Copy built files
COPY --from=builder /app/dist ./dist

# Set environment
ENV NODE_ENV=production
ENV PORT=${port}

EXPOSE ${port}

# Non-root user
USER node

# Start
CMD ["node", "dist/index.js"]
`;
  }

  /**
   * Generate Python Dockerfile
   */
  private generatePythonDockerfile(config?: Partial<DockerConfig>): string {
    const port = config?.port || 8000;

    return `# Build stage
FROM python:3.12-slim AS builder

WORKDIR /app

# Install build dependencies
RUN pip install --no-cache-dir poetry

# Copy dependency files
COPY pyproject.toml poetry.lock ./

# Install dependencies
RUN poetry config virtualenvs.create false && \\
    poetry install --no-interaction --no-ansi --no-root --only main

# Production stage
FROM python:3.12-slim AS production

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy source
COPY . .

ENV PYTHONUNBUFFERED=1
ENV PORT=${port}

EXPOSE ${port}

# Non-root user
RUN useradd -m appuser
USER appuser

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${port}"]
`;
  }

  /**
   * Generate Go Dockerfile
   */
  private generateGoDockerfile(config?: Partial<DockerConfig>): string {
    const port = config?.port || 8080;

    return `# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source
COPY . .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Production stage
FROM alpine:latest AS production

WORKDIR /app

# Install ca-certificates
RUN apk --no-cache add ca-certificates

# Copy binary
COPY --from=builder /app/main .

ENV PORT=${port}

EXPOSE ${port}

# Non-root user
RUN adduser -D appuser
USER appuser

CMD ["./main"]
`;
  }

  /**
   * Generate Docker Compose file
   */
  generateDockerCompose(_config?: Partial<ComposeConfig>): string {
    const port = 3000;
    const serviceName = this.metadata.name.toLowerCase().replace(/[^a-z0-9]/g, "-");

    return `version: '3.8'

services:
  ${serviceName}:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "\${PORT:-${port}}:${port}"
    environment:
      - NODE_ENV=\${NODE_ENV:-development}
    volumes:
      - .:/app
      - /app/node_modules
    restart: unless-stopped

  # Add additional services as needed
  # db:
  #   image: postgres:16-alpine
  #   environment:
  #     POSTGRES_USER: \${DB_USER:-app}
  #     POSTGRES_PASSWORD: \${DB_PASSWORD:-secret}
  #     POSTGRES_DB: \${DB_NAME:-app}
  #   volumes:
  #     - db-data:/var/lib/postgresql/data
  #   ports:
  #     - "5432:5432"

volumes:
  # db-data:

networks:
  default:
    name: ${serviceName}-network
`;
  }

  /**
   * Generate .dockerignore file
   */
  generateDockerignore(): string {
    return `# Dependencies
node_modules
.pnpm-store

# Build output
dist
build

# Development
.git
.gitignore
.env
.env.*
!.env.example

# IDE
.idea
.vscode
*.swp
*.swo

# Testing
coverage
.nyc_output

# Documentation
docs
*.md
!README.md

# CI/CD
.github
.gitlab-ci.yml

# Docker
Dockerfile
docker-compose*.yml
.dockerignore

# Misc
*.log
.DS_Store
Thumbs.db
`;
  }
}

/**
 * Create a Docker generator
 */
export function createDockerGenerator(metadata: ProjectMetadata): DockerGenerator {
  return new DockerGenerator(metadata);
}
