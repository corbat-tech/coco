# Corbat-Coco Architecture

> Autonomous Coding Agent with Self-Review and Quality Convergence

---

## Overview

Corbat-Coco follows a **phase-based architecture** inspired by modern software development methodologies. The system is designed to transform natural language requirements into production-ready code through iterative refinement.

## System Context (C4 Level 1)

```mermaid
graph TB
    subgraph Users
        DEV[Developer]
    end

    subgraph "Corbat-Coco System"
        COCO[Corbat-Coco Agent]
    end

    subgraph "External Systems"
        LLM[LLM Providers<br/>Claude, GPT-4, Ollama]
        GH[GitHub]
        FS[Local Filesystem]
        TOOLS[Build Tools<br/>npm, tsc, vitest]
    end

    DEV -->|Natural language<br/>requirements| COCO
    COCO -->|Generated code<br/>& documentation| DEV
    COCO <-->|API calls| LLM
    COCO <-->|Git operations| GH
    COCO <-->|File operations| FS
    COCO <-->|Build & test| TOOLS
```

## Container Diagram (C4 Level 2)

```mermaid
graph TB
    subgraph "Corbat-Coco"
        CLI[CLI Interface<br/>Commander.js]
        ORCH[Orchestrator<br/>State Machine]

        subgraph Phases
            CONV[Converge<br/>Discovery Engine]
            PLAN[Orchestrate<br/>Planner]
            EXEC[Complete<br/>Executor]
            OUTP[Output<br/>Deployer]
        end

        TOOLS[Tool Layer<br/>File, Bash, Git, Quality]
        PERSIST[Persistence<br/>Checkpoints, State]
        PROV[LLM Providers<br/>Anthropic, OpenAI]
    end

    CLI --> ORCH
    ORCH --> CONV
    ORCH --> PLAN
    ORCH --> EXEC
    ORCH --> OUTP
    CONV --> TOOLS
    PLAN --> TOOLS
    EXEC --> TOOLS
    OUTP --> TOOLS
    ORCH --> PERSIST
    CONV --> PROV
    PLAN --> PROV
    EXEC --> PROV
```

## Component Diagram (C4 Level 3)

### Orchestrator Components

```mermaid
graph LR
    subgraph Orchestrator
        SM[State Machine]
        SESS[Session Manager]
        REC[Recovery Engine]
        EVT[Event Emitter]
        PROG[Progress Reporter]
    end

    SM --> SESS
    SM --> REC
    SM --> EVT
    EVT --> PROG
```

### Phase Components

```mermaid
graph TB
    subgraph "Converge Phase"
        DISC[Discovery Engine]
        CLAR[Clarifier]
        SPEC[Specifier]
    end

    subgraph "Orchestrate Phase"
        ARCH[Architect]
        ADR[ADR Manager]
        BACK[Backlogger]
        STD[Standards Engine]
    end

    subgraph "Complete Phase"
        TEXEC[Task Executor]
        TEST[Test Runner]
        REV[Reviewer]
        IMP[Improver]
        VER[Versioner]
    end

    subgraph "Output Phase"
        DEP[Deployer]
        DOC[Documenter]
        PUB[Publisher]
    end

    DISC --> CLAR --> SPEC
    ARCH --> ADR
    ARCH --> BACK
    BACK --> STD
    TEXEC --> TEST --> REV --> IMP
    IMP --> VER
    DEP --> DOC --> PUB
```

## Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as CLI
    participant O as Orchestrator
    participant P as Phase
    participant T as Tools
    participant L as LLM

    U->>CLI: coco init "Todo API"
    CLI->>O: Initialize project
    O->>P: Start CONVERGE phase

    loop Discovery
        P->>L: Generate questions
        L-->>P: Clarifying questions
        P->>CLI: Display questions
        CLI->>U: Ask questions
        U-->>CLI: Answers
        CLI->>P: User responses
    end

    P->>O: Specification complete
    O->>P: Start ORCHESTRATE phase
    P->>L: Design architecture
    L-->>P: Architecture decisions
    P->>T: Write ADRs
    P->>O: Planning complete

    O->>P: Start COMPLETE phase
    loop For each task
        loop Until excellent
            P->>L: Generate code
            L-->>P: Code + tests
            P->>T: Write files
            P->>T: Run tests
            T-->>P: Test results
            P->>P: Calculate quality
            alt Score < 85
                P->>L: Analyze issues
                L-->>P: Improvements
            end
        end
        P->>T: Save checkpoint
    end

    O->>P: Start OUTPUT phase
    P->>T: Generate CI/CD
    P->>T: Generate docs
    P->>CLI: Complete
    CLI->>U: Project ready!
```

## Key Design Decisions

### 1. Phase-Based Architecture

The system operates in four distinct phases:

| Phase | Purpose | Key Output |
|-------|---------|------------|
| **Converge** | Understand requirements | Specification |
| **Orchestrate** | Plan architecture | ADRs, Backlog |
| **Complete** | Build with iteration | Working code |
| **Output** | Prepare for production | CI/CD, Docs |

**Rationale:** Clear separation allows for checkpointing, recovery, and focused optimization of each phase.

### 2. Quality-Driven Iteration

Code is iteratively improved until it meets senior-level quality standards:

```
Score >= 85 AND (Score[n] - Score[n-1] < 2)
```

**Rationale:** Ensures consistently high-quality output without infinite loops.

### 3. Checkpoint-Based Recovery

State is persisted at key moments:
- Phase transitions
- Task start/complete
- Every 5 minutes
- On error

**Rationale:** Enables recovery from any interruption without losing progress.

### 4. Tool Abstraction Layer

All file system, process, and external tool interactions go through a unified tool layer.

**Rationale:** Enables testing, auditing, and potential sandboxing of operations.

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Node.js 22+ | Modern ESM, good perf |
| Language | TypeScript 5.4+ | Type safety, tooling |
| CLI | Commander.js | Mature, well-documented |
| Prompts | @clack/prompts | Beautiful terminal UI |
| Validation | Zod | Runtime type checking |
| Testing | Vitest | Fast, ESM-native |
| Linting | Oxlint | Fast, low config |
| LLM | Anthropic SDK | Best for coding tasks |

## Security Considerations

1. **API Keys**: Stored in environment variables, never in config files
2. **File Operations**: Restricted to project directory by default
3. **Bash Execution**: Sandboxed with timeout limits
4. **Checkpoints**: Stored locally with restricted permissions

## Scalability

The architecture supports:

- **Large Projects**: Incremental processing, context management
- **Multiple LLM Providers**: Abstraction layer allows switching
- **Custom Tools**: Plugin system for domain-specific tools
- **Parallel Execution**: Independent tasks can run concurrently

## Future Considerations

1. **GUI Application**: Electron-based desktop app
2. **Team Features**: Shared projects, collaborative editing
3. **Cloud Sync**: Remote checkpoint storage
4. **Custom LLMs**: Fine-tuned models for specific domains
