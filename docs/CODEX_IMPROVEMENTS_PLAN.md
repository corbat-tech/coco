# Plan: Mejoras de Coco inspiradas en Codex y Claude Code

## Status Tracker

| # | Feature | Phase | Status | Branch/PR |
|---|---------|-------|--------|-----------|
| 1.1 | Subagent Specialization System | 1 | ✅ DONE | work/codex-improvements |
| 1.2 | Enhanced Plan Mode | 1 | ✅ DONE | work/codex-improvements |
| 1.3 | Context Compaction++ | 1 | ✅ DONE | work/codex-improvements |
| 2.1 | Worktree Isolation per Agent | 2 | ✅ DONE | work/codex-improvements |
| 2.2 | Best-of-N Solutions | 2 | ✅ DONE | work/codex-improvements |
| 2.3 | Mid-Task Steering | 2 | ✅ DONE | work/codex-improvements |
| 3.1 | Automations System | 3 | 🔲 NOT STARTED | — |
| 3.2 | Headless/CI Mode | 3 | ✅ DONE | work/codex-improvements |
| 3.3 | GitHub Code Review Bot | 3 | 🔲 NOT STARTED | — |
| 4.1 | Skills Declarativos Auto-Invocables | 4 | 🔲 NOT STARTED | — |
| 4.2 | MCP Tool Search Dinámico | 4 | 🔲 NOT STARTED | — |
| 4.3 | Unix Composability | 4 | ✅ DONE | work/codex-improvements |
| 4.4 | Layered Config (COCO.md) | 4 | ✅ DONE | work/codex-improvements |
| 5.1 | Task Tracking Integrado | 5 | 🔲 NOT STARTED | — |
| 5.2 | Checkpoint Rollback++ | 5 | 🔲 NOT STARTED | — |

---

## Phase 1: Fundamentos del Agent Loop (CRITICAL)

### 1.1 Subagent Specialization System

**Objetivo**: Unificar los dos sistemas de subagentes y exponer roles especializados al LLM.

**Estado actual**:
- `AgentManager` (`src/cli/repl/agents/manager.ts`): 12 typed agents (explore, plan, test, debug, review, architect, security, tdd, refactor, e2e, docs, database) con tool whitelists y prompts especializados.
- `AgentExecutor` (usado por `src/tools/simple-agent.ts`): 6 roles simples (researcher, coder, tester, reviewer, optimizer, planner) con su propio sistema separado.
- El LLM del REPL solo puede usar `spawnSimpleAgent` que usa `AgentExecutor`, NO `AgentManager`.

**Cambios requeridos**:
1. **`src/tools/simple-agent.ts`**: Refactorizar para usar `AgentManager` en lugar de `AgentExecutor`. El parámetro `role` debe mapear a los 12 tipos de `AgentManager` (explore, plan, review, etc.).
2. **`src/cli/repl/agents/types.ts`**: Añadir `AgentRole` enum con los roles disponibles para el LLM. Incluir metadata (descripción, modelo sugerido, read-only flag).
3. **`src/cli/repl/agents/prompts.ts`**: Verificar que todos los 12 tipos tienen prompts y tool lists adecuados. Ajustar si es necesario.
4. **`src/cli/repl/agents/manager.ts`**: Asegurar que `spawn()` funciona correctamente cuando se invoca desde un tool (actualmente diseñado para uso interno).
5. **Deprecar** `src/agents/executor.ts` y `AGENT_ROLES` del viejo sistema.

**Archivos a modificar**:
- `src/tools/simple-agent.ts` — Refactorizar para usar AgentManager
- `src/cli/repl/agents/manager.ts` — Adaptar para uso desde tools
- `src/cli/repl/agents/types.ts` — Añadir AgentRole enum
- `src/cli/repl/agents/prompts.ts` — Verificar completitud
- `src/tools/index.ts` — Actualizar registro si cambia la tool definition

**Acceptance Criteria**:
- [ ] `spawnSimpleAgent` tool usa `AgentManager` internamente
- [ ] El LLM puede especificar `type: "explore"` para spawnar un agente read-only
- [ ] Los tool whitelists del `AgentManager` se aplican correctamente a subagentes
- [ ] Los prompts especializados se inyectan por tipo de agente
- [ ] El viejo `AgentExecutor` se depreca o elimina
- [ ] Tests: unit tests para spawn de cada tipo de agente
- [ ] `pnpm check` pasa limpio

---

### 1.2 Enhanced Plan Mode

**Objetivo**: Modo plan read-only con flujo explore → plan → approve → execute.

**Estado actual**:
- `/plan` en REPL ejecuta `runOrchestratePhase()` del COCO pipeline completo (análisis de arquitectura, creación de backlog). Es para el flujo COCO, no para planificación ad-hoc.
- No hay un modo "read-only" en el agent loop que impida escrituras.
- No hay flujo de aprobación antes de ejecutar.

**Cambios requeridos**:
1. **`src/cli/repl/commands/plan.ts`**: Nuevo behavior para `/plan [instrucción]`:
   - Activa `session.planMode = true`
   - Inyecta system prompt de planificación
   - Agent usa solo herramientas read-only (glob, grep, read_file, list_dir, bash read-only)
   - Genera plan estructurado en markdown
   - Al finalizar: presenta plan con opciones [Approve / Edit / Reject]
2. **`src/cli/repl/agent-loop.ts`**: Respetar `session.planMode`:
   - Filtrar tools a solo read-only cuando `planMode=true`
   - Usar prompt de planificación
3. **`src/cli/repl/types.ts`**: Añadir `planMode: boolean` y `pendingPlan: string | null` a `ReplSession`.
4. **Nuevo**: `src/cli/repl/plan/executor.ts` — Ejecuta un plan aprobado (parsea steps, ejecuta secuencialmente).
5. **`src/cli/repl/commands/index.ts`**: Registrar el command actualizado.

**Read-only tool whitelist**:
```
glob, read_file, list_dir, grep, find_in_file, semantic_search, codebase_map,
git_status, git_log, git_diff, git_show, bash_exec (solo comandos read-only)
```

**Archivos a modificar**:
- `src/cli/repl/commands/plan.ts` — Reescribir behavior
- `src/cli/repl/agent-loop.ts` — Soporte planMode
- `src/cli/repl/types.ts` — Añadir planMode fields
- `src/cli/repl/session.ts` — Prompt de planificación
- Nuevo: `src/cli/repl/plan/executor.ts` — Plan execution
- `src/cli/repl/commands/index.ts` — Registro

**Acceptance Criteria**:
- [ ] `/plan <instrucción>` activa modo read-only
- [ ] Agent NO puede escribir archivos ni ejecutar comandos destructivos en plan mode
- [ ] Agent genera un plan estructurado con steps numerados
- [ ] Al finalizar el plan, se presenta al usuario con opciones Approve/Edit/Reject
- [ ] "Approve" ejecuta automáticamente el plan con herramientas completas
- [ ] "Reject" cancela y vuelve al REPL normal
- [ ] "Edit" permite modificar el plan antes de ejecutar
- [ ] Tests: plan mode tool filtering, plan execution flow
- [ ] `pnpm check` pasa limpio

---

### 1.3 Context Compaction Mejorada

**Objetivo**: Compactación inteligente con focus preservation y triggers manuales.

**Estado actual**:
- `ContextCompactor` (`src/cli/repl/context/compactor.ts`): Compacta mensajes antiguos usando LLM summary. Preserva últimos N mensajes. Respeta pares tool_use/tool_result.
- `/compact` (`src/cli/repl/commands/compact.ts`): Solo toggling verbose mode (NO compacta contexto). Misleading.
- Auto-compaction se dispara en el REPL loop cuando el contexto excede un threshold.

**Cambios requeridos**:
1. **`src/cli/repl/commands/compact.ts`**: Reescribir como trigger manual de compactación:
   - `/compact` — Compactar contexto ahora
   - `/compact focus on <topic>` — Compactar preservando contexto sobre un tema específico
   - Mostrar métricas antes/después (tokens ahorrados)
2. **`src/cli/repl/context/compactor.ts`**: Mejoras:
   - Añadir `focusTopic?: string` al método `compact()`
   - Cuando hay focus topic: instruir al LLM summarizer a preservar detalles sobre ese tema
   - Always preserve: original user requests, file paths edited, errors encountered
   - Métricas: devolver `{ before: tokenCount, after: tokenCount, preserved: string[] }`
3. **Nuevo**: `/context` command — Muestra uso actual de contexto:
   - Total tokens usados vs. límite del modelo
   - Desglose: system prompt, conversation, tool results
   - Recomendación de compactación si >70% usado
4. **`src/cli/repl/context/`**: Añadir `metrics.ts` para tracking de uso.
5. **Configuración**: `auto_compact_threshold` en config (default 70%).

**Archivos a modificar**:
- `src/cli/repl/commands/compact.ts` — Reescribir como manual compaction trigger
- `src/cli/repl/context/compactor.ts` — Añadir focus topic, metrics, preserve rules
- Nuevo: `src/cli/repl/commands/context.ts` — /context command
- Nuevo: `src/cli/repl/context/metrics.ts` — Context usage tracking
- `src/cli/repl/commands/index.ts` — Registrar /context
- `src/cli/repl/index.ts` — Usar threshold configurable para auto-compaction

**Acceptance Criteria**:
- [ ] `/compact` trigger manual que compacta contexto inmediatamente
- [ ] `/compact focus on auth` preserva mensajes relacionados con auth durante compactación
- [ ] `/context` muestra métricas de uso (tokens, %, desglose)
- [ ] Compactación siempre preserva: user requests originales, file paths editados, errores
- [ ] Métricas before/after mostradas al usuario tras compactar
- [ ] Auto-compaction threshold configurable
- [ ] Tests: focus preservation, metrics accuracy
- [ ] `pnpm check` pasa limpio

---

## Phase 2: Multi-Agent & Parallelism

### 2.1 Worktree Isolation per Agent

**Objetivo**: Cada agente paralelo trabaja en su propio git worktree para evitar conflictos.

**Estado actual**:
- `BackgroundTaskManager` (`src/cli/repl/background/manager.ts`): Ejecuta tareas en background con semáforo de concurrencia. No tiene concepto de worktrees.
- `SwarmOrchestrator` (`src/swarm/`): Ejecuta features en secuencia (no paralelo real per-worktree).
- Git tools existen pero no manejan worktrees.

**Cambios requeridos**:
1. **Nuevo**: `src/cli/repl/worktree/manager.ts` — `WorktreeManager`:
   - `create(branchName: string)`: `git worktree add .worktrees/<name> -b <branch>`
   - `remove(name: string)`: `git worktree remove .worktrees/<name>`
   - `list()`: `git worktree list` parsed
   - `merge(name: string, strategy: "merge"|"rebase"|"pr")`: Merge worktree back
   - Cleanup automático on abort/timeout
2. **Nuevo**: `src/cli/repl/worktree/merger.ts` — Estrategias de merge:
   - `merge`: git merge directo
   - `rebase`: git rebase sobre main
   - `pr`: crear PR por worktree para review manual
3. **`src/cli/repl/background/manager.ts`**: Integrar worktree lifecycle:
   - `createTask()` acepta `worktree: true` option
   - Si `worktree: true`, crear worktree antes de ejecutar, cleanup al completar
4. **`src/swarm/sprint-runner.ts`** (si existe) o `src/swarm/lifecycle.ts`: Usar worktrees para features paralelas.

**Archivos a crear/modificar**:
- Nuevo: `src/cli/repl/worktree/manager.ts`
- Nuevo: `src/cli/repl/worktree/merger.ts`
- Nuevo: `src/cli/repl/worktree/types.ts`
- Nuevo: `src/cli/repl/worktree/index.ts`
- `src/cli/repl/background/manager.ts` — Integrar worktree lifecycle
- `src/swarm/lifecycle.ts` — Usar worktrees en feature loop

**Acceptance Criteria**:
- [ ] `WorktreeManager.create()` crea worktree git funcional
- [ ] `WorktreeManager.remove()` limpia worktree correctamente
- [ ] `WorktreeManager.merge()` soporta merge, rebase, y PR strategies
- [ ] Background tasks con `worktree: true` se ejecutan en worktree aislado
- [ ] Cleanup automático si el agente aborta o timeout
- [ ] Dos agentes paralelos NO causan conflictos de archivos
- [ ] Tests: create/remove/merge lifecycle, concurrent isolation
- [ ] `pnpm check` pasa limpio

---

### 2.2 Best-of-N Solutions

**Objetivo**: Ejecutar N intentos independientes y seleccionar el mejor por quality score.

**Estado actual**:
- Quality scoring existe en `src/quality/` (12 dimensiones, score 0-100).
- No hay concepto de intentos múltiples.
- Worktree isolation (2.1) es prerequisito.

**Cambios requeridos**:
1. **Nuevo**: `src/cli/repl/best-of-n.ts` — `BestOfNOrchestrator`:
   - `run(task: string, n: number, options?)`: Spawn N workers en worktrees paralelos
   - Cada worker ejecuta la misma tarea independientemente
   - Recolecta resultados + quality scores
   - Presenta ranking al usuario
   - Aplica la solución seleccionada (merge worktree ganador)
2. **`src/cli/index.ts`**: Añadir `--attempts N` flag al command `chat`.
3. **Nuevo**: `/best-of N` slash command en REPL.
4. **Integración** con quality scorer para evaluación.

**Archivos a crear/modificar**:
- Nuevo: `src/cli/repl/best-of-n.ts`
- `src/cli/index.ts` — `--attempts` flag
- Nuevo: `src/cli/repl/commands/best-of.ts`
- `src/cli/repl/commands/index.ts` — Registrar command

**Acceptance Criteria**:
- [ ] `--attempts 3` ejecuta 3 intentos en paralelo
- [ ] Cada intento trabaja en su propio worktree
- [ ] Quality scorer evalúa cada solución independientemente
- [ ] Ranking presentado al usuario con scores y diffs
- [ ] Usuario selecciona la mejor → se aplica (merge)
- [ ] Las demás soluciones se limpian
- [ ] Tests: orchestration, ranking, merge of winner
- [ ] `pnpm check` pasa limpio

**Dependencias**: 2.1 (Worktree Isolation)

---

### 2.3 Mid-Task Steering

**Objetivo**: Permitir al usuario intervenir durante la ejecución del agente sin esperar a que termine.

**Estado actual**:
- El REPL tiene `ConcurrentInputCapture` que captura input del usuario durante ejecución y lo clasifica como Abort/Modify/Queue.
- "Abort" cancela la ejecución actual.
- "Modify" re-envía con modificaciones.
- "Queue" guarda para el siguiente turno.
- No hay opción de inyectar context en medio de la ejecución.

**Cambios requeridos**:
1. **`src/cli/repl/agent-loop.ts`**: Entre cada tool call (en el loop principal), check si hay input pendiente del usuario:
   - Si clasificado como "steer" (nueva clasificación) → inyectar como user message con role `system` o `user` para que el agente ajuste su comportamiento
   - Continuar ejecución con el nuevo contexto
2. **`src/cli/repl/concurrent-capture.ts`** (o equivalente): Añadir clasificación "steer" para mensajes que no son abort ni nueva tarea.
3. **UI**: Mostrar indicador `[Press Enter to steer agent]` durante ejecución.

**Archivos a modificar**:
- `src/cli/repl/agent-loop.ts` — Check input entre tool calls
- Input capture system — Añadir clasificación "steer"
- `src/cli/repl/index.ts` — UI indicator

**Acceptance Criteria**:
- [ ] Durante ejecución, el usuario puede escribir un mensaje
- [ ] El mensaje se inyecta como contexto adicional entre tool calls
- [ ] El agente ajusta su comportamiento basado en el nuevo contexto
- [ ] No rompe el flujo existente de abort/modify/queue
- [ ] Indicador visual de que se puede intervenir
- [ ] Tests: steering injection, agent behavior adjustment
- [ ] `pnpm check` pasa limpio

---

## Phase 3: Automatización y CI

### 3.1 Automations System

**Objetivo**: Tareas recurrentes que se ejecutan automáticamente según schedule.

**Estado actual**: No existe.

**Cambios requeridos**:
1. **Nuevo directorio**: `src/automations/`
   - `types.ts` — `Automation`, `AutomationSchedule`, `AutomationResult`
   - `scheduler.ts` — Cron-like scheduler (node-cron o implementación propia)
   - `runner.ts` — Ejecutor de automations (usa provider + tools)
   - `inbox.ts` — Almacena resultados para review posterior
   - `config.ts` — Parser de `.coco/automations.yaml`
2. **`src/cli/commands/automate.ts`**: CLI command:
   - `coco automate list` — Lista automations configuradas
   - `coco automate run <name>` — Ejecuta una manualmente
   - `coco automate enable/disable <name>`
   - `coco automate inbox` — Ver resultados pendientes
3. **Config format** (`.coco/automations.yaml`):
   ```yaml
   automations:
     - name: "issue-triage"
       schedule: "0 9 * * *"
       prompt: "Review open issues, label and prioritize"
       worktree: true
       model: "fast"
   ```

**Archivos a crear**:
- `src/automations/types.ts`
- `src/automations/scheduler.ts`
- `src/automations/runner.ts`
- `src/automations/inbox.ts`
- `src/automations/config.ts`
- `src/automations/index.ts`
- `src/cli/commands/automate.ts`
- `src/cli/index.ts` — Registrar command

**Acceptance Criteria**:
- [ ] `.coco/automations.yaml` parsed correctamente
- [ ] Scheduler ejecuta automations según cron schedule
- [ ] Cada automation se ejecuta con su propio provider instance
- [ ] Resultados almacenados en inbox
- [ ] CLI: list, run, enable/disable, inbox funcionan
- [ ] Automations pueden usar worktrees (si habilitado)
- [ ] Tests: scheduler, runner, config parser
- [ ] `pnpm check` pasa limpio

---

### 3.2 Headless/CI Mode

**Objetivo**: Modo no-interactivo para CI/CD pipelines.

**Estado actual**:
- El CLI requiere interacción (REPL, prompts de @clack).
- No hay modo "one-shot" que procese un prompt y devuelva resultado.

**Cambios requeridos**:
1. **`src/cli/index.ts`**: Añadir flag `--print` / `-p` al command `chat`:
   - Si `-p`: no inicia REPL, ejecuta un turno del agente y devuelve resultado
2. **Nuevo**: `src/cli/headless.ts` — `runHeadless(prompt, options)`:
   - Crea session, provider, tool registry (sin interactive prompts)
   - Ejecuta un agent turn
   - Output a stdout (text plano o JSON con `--output json`)
   - Exit code: 0 = success, 1 = error, 2 = timeout
3. **Stdin support**: Si stdin es pipe, leer como contexto adicional.
4. **Timeout**: `--timeout <seconds>` (default 300s para CI).

**Uso**:
```bash
coco -p "review this PR and comment"
echo "fix auth bug" | coco -p
coco -p --output json "analyze security"
coco -p --timeout 60 "run tests and report"
```

**Archivos a crear/modificar**:
- `src/cli/index.ts` — Flags -p, --output, --timeout
- Nuevo: `src/cli/headless.ts`
- `src/cli/repl/session.ts` — Session creation sin interactive

**Acceptance Criteria**:
- [ ] `coco -p "prompt"` ejecuta sin REPL y devuelve resultado a stdout
- [ ] `echo "context" | coco -p "prompt"` lee stdin como contexto
- [ ] `--output json` devuelve JSON estructurado
- [ ] Exit code correcto (0/1/2)
- [ ] `--timeout` cancela ejecución si excede
- [ ] Sin prompts interactivos (no pide confirmación de nada)
- [ ] Tests: headless execution, stdin pipe, JSON output, timeout
- [ ] `pnpm check` pasa limpio

---

### 3.3 GitHub Code Review Bot

**Objetivo**: Review automático de PRs con inline comments via GitHub API.

**Estado actual**:
- `src/tools/github.ts` tiene tools de GitHub CLI (gh pr, gh issue, etc.).
- `src/tools/review.ts` tiene review tool básico.
- No hay integración directa con GitHub PR Review API para inline comments.

**Cambios requeridos**:
1. **Nuevo**: `src/integrations/github-review-bot.ts`:
   - `reviewPR(prNumber: number, options?)`: Fetch diff → analyze → post review
   - Usa `gh api` para fetch PR diff, files changed
   - Analiza cada file changed con quality tools
   - Posts inline comments via `gh api repos/{owner}/{repo}/pulls/{pr}/reviews`
   - Summary comment con score overall
2. **`src/tools/github.ts`**: Extender con `review_pr` tool callable por el LLM.
3. **Slash command**: `/review-pr <number>` en REPL.

**Archivos a crear/modificar**:
- Nuevo: `src/integrations/github-review-bot.ts`
- `src/tools/github.ts` — Añadir review_pr tool
- Nuevo: `src/cli/repl/commands/review-pr.ts`
- `src/cli/repl/commands/index.ts` — Registrar

**Acceptance Criteria**:
- [ ] `coco -p "review PR #123"` o `/review-pr 123` analiza un PR
- [ ] Inline comments en el diff con sugerencias específicas
- [ ] Summary comment con quality score
- [ ] Funciona con `gh` CLI (requiere auth previa)
- [ ] Tests: diff parsing, comment generation, API integration (mocked)
- [ ] `pnpm check` pasa limpio

---

## Phase 4: Extensibilidad y UX

### 4.1 Skills Declarativos Auto-Invocables

**Objetivo**: Skills como `.md` con YAML frontmatter que se auto-invocan basado en triggers.

**Estado actual**:
- `UnifiedSkillRegistry` carga skills markdown y nativos.
- Skills se auto-activan basado en similaridad coseno del mensaje.
- No hay YAML frontmatter con triggers explícitos.

**Cambios requeridos**:
1. **Nuevo**: `src/skills/loader.ts` — Parser de YAML frontmatter en `.md` skills:
   ```yaml
   ---
   name: security-review
   description: Review code for OWASP Top 10
   triggers: ["security", "vulnerability", "auth code"]
   tools: [read, search, bash]
   model: strong
   ---
   ```
2. **Nuevo**: `src/skills/matcher.ts` — Auto-matching mejorado:
   - Pattern matching por triggers (keywords/regex)
   - Fallback a similaridad coseno
3. **`src/cli/repl/index.ts`**: Integrar nuevo matcher en auto-activation.

**Archivos a crear/modificar**:
- Nuevo: `src/skills/loader.ts`
- Nuevo: `src/skills/matcher.ts`
- `src/cli/repl/index.ts` — Integrar

**Acceptance Criteria**:
- [ ] Skills con YAML frontmatter se parsean correctamente
- [ ] `triggers` field permite matching por keywords/regex
- [ ] `tools` field limita las herramientas del skill
- [ ] `model` field sugiere el modelo a usar
- [ ] Auto-invocation funciona con triggers
- [ ] Tests: YAML parser, trigger matching, tool filtering
- [ ] `pnpm check` pasa limpio

---

### 4.2 MCP Tool Search Dinámico

**Objetivo**: Cargar herramientas MCP bajo demanda en vez de precargar todas.

**Estado actual**:
- MCP servers se inician al startup del REPL.
- Todas las herramientas se registran al arrancar.
- Con muchos servidores, consume contexto significativo.

**Cambios requeridos**:
1. **`src/cli/repl/mcp/`**: Nuevo directorio:
   - `lazy-loader.ts` — Carga herramientas MCP on-demand
   - `search.ts` — Busca herramientas MCP por descripción/nombre
2. **Tool search tool**: El LLM puede buscar herramientas disponibles sin cargarlas todas.
3. **Lazy registration**: Solo registra las herramientas que el LLM solicita.

**Acceptance Criteria**:
- [ ] MCP tools no se cargan todas al startup
- [ ] LLM puede buscar herramientas por keyword
- [ ] Herramientas se cargan on-demand cuando se necesitan
- [ ] Reduce uso de contexto con muchos servidores MCP
- [ ] Tests: lazy loading, search, on-demand registration
- [ ] `pnpm check` pasa limpio

---

### 4.3 Unix Composability

**Objetivo**: Soporte para piping stdin/stdout para integración con workflow Unix.

**Estado actual**: No existe soporte para stdin pipe.

**Cambios requeridos**:
1. **`src/cli/index.ts`**: Detectar si stdin es pipe (`!process.stdin.isTTY`).
2. **Nuevo**: `src/cli/pipe-handler.ts`:
   - Lee stdin completo
   - Lo inyecta como contexto en el prompt
   - Ejecuta en modo headless (requiere 3.2)
   - Output a stdout

**Uso**:
```bash
cat error.log | coco -p "explain these errors"
git diff | coco -p "review these changes"
```

**Dependencias**: 3.2 (Headless Mode)

**Acceptance Criteria**:
- [ ] `echo "text" | coco -p "analyze"` funciona
- [ ] Stdin content se inyecta como contexto
- [ ] Output va a stdout (no stderr con UI noise)
- [ ] Funciona en pipelines Unix complejos
- [ ] Tests: pipe detection, content injection
- [ ] `pnpm check` pasa limpio

---

### 4.4 Layered Config (COCO.md)

**Objetivo**: Configuración jerárquica que se resuelve por proximidad.

**Estado actual**:
- Config se carga desde `src/config/` con Zod schemas.
- No hay resolución jerárquica de archivos `.md` de configuración.

**Cambios requeridos**:
1. **Nuevo**: `src/config/layered-config.ts`:
   - Busca `COCO.md` en jerarquía: `~/.coco/` → `<git-root>/.coco/` → `<cwd>/.coco/`
   - Merge por proximidad (más cercano gana)
   - `COCO.override.md` tiene prioridad absoluta
   - Parsea frontmatter YAML + markdown content
2. **`src/cli/repl/session.ts`**: Inyectar config layers en system prompt.

**Jerarquía** (de menor a mayor prioridad):
1. `~/.coco/COCO.md` — Global (preferencias personales)
2. `<git-root>/.coco/COCO.md` — Proyecto (instrucciones del equipo)
3. `<dir>/.coco/COCO.md` — Directorio (instrucciones específicas)
4. `<any-level>/COCO.override.md` — Override explícito (máxima prioridad)

**Acceptance Criteria**:
- [ ] `~/.coco/COCO.md` se carga como config global
- [ ] `<project>/.coco/COCO.md` override global
- [ ] `<dir>/.coco/COCO.md` override project
- [ ] `COCO.override.md` tiene prioridad máxima
- [ ] Config se inyecta en system prompt
- [ ] Tests: hierarchy resolution, override behavior
- [ ] `pnpm check` pasa limpio

---

## Phase 5: Quality & Intelligence

### 5.1 Task Tracking Integrado

**Objetivo**: Sistema de TODO/tasks visible durante la sesión con auto-creation.

**Estado actual**:
- Swarm tiene task board (`src/swarm/lifecycle.ts`), pero es para el COCO pipeline.
- No hay tracking de tasks en el REPL.

**Cambios requeridos**:
1. **`src/cli/repl/commands/tasks.ts`**: Mejorar o crear:
   - `/tasks` — Board visual: pending | in-progress | done
   - `/tasks add <description>` — Añadir task manual
   - `/tasks done <id>` — Marcar como completada
2. **Auto-creation**: Cuando el agente identifica sub-tareas, las añade automáticamente.
3. **Progress**: Mostrar en output del REPL.

**Acceptance Criteria**:
- [ ] `/tasks` muestra board con columnas
- [ ] Tasks se crean automáticamente cuando el agente identifica sub-tareas
- [ ] Tasks se actualizan al completarse
- [ ] `/tasks add` y `/tasks done` funcionan
- [ ] Progreso visible en output
- [ ] Tests: task CRUD, auto-creation
- [ ] `pnpm check` pasa limpio

---

### 5.2 Checkpoint Rollback Mejorado

**Objetivo**: Rollback instantáneo a cualquier punto previo con UX mejorada.

**Estado actual**:
- Checkpoint tools existen (create, restore, list).
- `/rewind` command existe.
- No hay auto-snapshot antes de cada file edit.

**Cambios requeridos**:
1. **Auto-snapshot**: Antes de CADA `write_file` o `edit_file`, crear checkpoint automático.
2. **`/rewind` mejorado**: Selector interactivo con timestamps, descripciones, y diff preview.
3. **Visual**: Lista de checkpoints con contexto (qué se hizo en cada punto).

**Acceptance Criteria**:
- [ ] Checkpoint automático antes de cada file edit
- [ ] `/rewind` muestra lista interactiva de checkpoints
- [ ] Diff preview antes de confirmar rollback
- [ ] Rollback es instantáneo (git stash/restore)
- [ ] Tests: auto-checkpoint, rewind selection, restore
- [ ] `pnpm check` pasa limpio

---

## Verification Checklist (Per Feature)

1. ✅ Unit tests (vitest) — mínimo 80% coverage del nuevo código
2. ✅ Test de integración manual en el REPL
3. ✅ `pnpm check` limpio (typecheck + lint + test)
4. ✅ JSDoc para APIs públicas
5. ✅ ADR si es decisión arquitectónica significativa
6. ✅ Status actualizado en tracker de arriba
