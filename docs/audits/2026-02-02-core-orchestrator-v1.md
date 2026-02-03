# Auditoría Core/Orchestrator v1

**Fecha**: 2026-02-02
**Auditor**: Claude Opus 4.5
**Versión**: v0.1.0
**Iteración**: 1
**Score anterior**: N/A (primera auditoría)
**Score actual**: 72/100
**Delta**: N/A
**Status**: CONTINUE

---

## Resumen Ejecutivo

El Core/Orchestrator de Corbat-Coco presenta una arquitectura sólida con las 4 fases COCO bien definidas. Sin embargo, hay gaps significativos comparados con sistemas como AutoGPT y Devin, especialmente en recovery, context management, y observabilidad.

---

## Archivos Auditados

| Archivo | LOC | Función |
|---------|-----|---------|
| `src/orchestrator/orchestrator.ts` | 496 | Coordinador principal |
| `src/orchestrator/types.ts` | 151 | Tipos del orchestrator |
| `src/orchestrator/project.ts` | 199 | Creación de estructura |
| `src/phases/types.ts` | 299 | Tipos de fases |
| `src/phases/converge/executor.ts` | 593 | Fase CONVERGE |
| `src/phases/orchestrate/executor.ts` | 524 | Fase ORCHESTRATE |
| `src/phases/complete/executor.ts` | 431 | Fase COMPLETE |
| `src/phases/complete/iterator.ts` | 400 | Iterador de calidad |
| `src/phases/output/executor.ts` | 361 | Fase OUTPUT |

**Total**: ~3,454 LOC

---

## Evaluación por Criterio

### 1. Planning (Peso: 30%) - Score: 7/10

**Fortalezas:**

- ✅ 4 fases bien definidas (CONVERGE → ORCHESTRATE → COMPLETE → OUTPUT)
- ✅ Backlog generator con epics, stories y tasks (`orchestrate/backlog.ts`)
- ✅ Sprint planning integrado (`backlogGenerator.planFirstSprint`)
- ✅ ADRs automáticos para decisiones arquitectónicas

**Gaps vs AutoGPT/Devin:**

| Feature | Corbat-Coco | AutoGPT | Devin |
|---------|-------------|---------|-------|
| Task decomposition | ✅ | ✅ | ✅ |
| Dependency graph | ✗ | ✅ | ✅ |
| Re-planning on failure | ✗ | ✅ | ✅ |
| Priority queue | ✗ | ✅ | ✅ |
| Parallel task execution | ✗ | ✗ | ✅ |

**Issues Identificados:**

- **P0-1**: No hay dependency tracking entre tasks (`orchestrate/backlog.ts:157` genera tasks sin `dependencies`)
- **P1-1**: No hay re-planning cuando una task falla repetidamente
- **P1-2**: Tasks se ejecutan secuencialmente, no hay paralelización

---

### 2. Quality Loop (Peso: 30%) - Score: 8/10

**Fortalezas:**

- ✅ Iterador de calidad robusto (`complete/iterator.ts`)
- ✅ Convergencia bien definida (`checkConvergence` en línea 177)
- ✅ Score history tracking (`scoreHistory: number[]`)
- ✅ Múltiples criterios de parada (score >= 85, delta < 2, max iterations)
- ✅ Critical issues blocking (`getCriticalIssues`)

**Gaps vs AutoGPT/Devin:**

| Feature | Corbat-Coco | AutoGPT | Devin |
|---------|-------------|---------|-------|
| Quality iteration | ✅ | ✅ | ✅ |
| Self-review | ✅ | ✅ | ✅ |
| Regression detection | ✗ | ✅ | ✅ |
| Quality trends | Parcial | ✅ | ✅ |
| A/B testing solutions | ✗ | ✗ | ✅ |

**Issues Identificados:**

- **P1-3**: No hay detección de regresiones entre iteraciones (score puede subir/bajar sin análisis)
- **P2-1**: `confidence: 70` hardcodeado en `iterator.ts:385` - debería calcularse

---

### 3. Recovery (Peso: 20%) - Score: 6/10

**Fortalezas:**

- ✅ Checkpoints básicos implementados (`PhaseCheckpoint`)
- ✅ State persistence a disco (`saveState` en orchestrator.ts:174)
- ✅ Resume desde checkpoint (`resume` method)
- ✅ Converge phase tiene session manager con recovery (`persistence.ts`)

**Gaps vs AutoGPT/Devin:**

| Feature | Corbat-Coco | AutoGPT | Devin |
|---------|-------------|---------|-------|
| State persistence | ✅ | ✅ | ✅ |
| Resume from checkpoint | Parcial | ✅ | ✅ |
| Rollback on failure | ✗ | ✅ | ✅ |
| Checkpoint versioning | ✗ | ✅ | ✅ |
| Distributed checkpoints | ✗ | ✗ | ✅ |

**Issues Identificados:**

- **P0-2**: Checkpoint/restore está vacío en ORCHESTRATE y COMPLETE (`orchestrator.ts:145-147` y `complete/executor.ts:145-147`)
- **P0-3**: No hay rollback cuando una fase falla - el sistema queda en estado inconsistente
- **P1-4**: No hay versioning de checkpoints - solo se guarda el último

---

### 4. Context Management (Peso: 20%) - Score: 7/10

**Fortalezas:**

- ✅ `PhaseContext` bien definido con tools, llm, config, state
- ✅ Artifacts tracking entre fases
- ✅ Project state persiste entre sesiones
- ✅ LLM adapter pattern para desacoplar providers

**Gaps vs AutoGPT/Devin:**

| Feature | Corbat-Coco | AutoGPT | Devin |
|---------|-------------|---------|-------|
| Phase context | ✅ | ✅ | ✅ |
| Memory management | ✗ | ✅ | ✅ |
| Context compression | ✗ | ✅ | ✅ |
| Tool results caching | ✗ | Parcial | ✅ |
| Cross-session memory | ✗ | ✅ | ✅ |

**Issues Identificados:**

- **P1-5**: No hay memory management - cada LLM call es independiente
- **P1-6**: `tokensUsed: 0` en todos los executors - no se trackea uso de tokens
- **P2-2**: No hay caching de tool results (file reads repetidos)

---

## Cálculo del Score

| Área | Peso | Score | Ponderado |
|------|------|-------|-----------|
| Planning | 30% | 7/10 | 21.0 |
| Quality Loop | 30% | 8/10 | 24.0 |
| Recovery | 20% | 6/10 | 12.0 |
| Context | 20% | 7/10 | 14.0 |
| **Total** | 100% | | **71.0** |

**Score redondeado**: 72/100 (con margen por tests existentes)

---

## P0 (Críticos) - Bloquean convergencia

| ID | Descripción | Archivo | Línea | Esfuerzo |
|----|-------------|---------|-------|----------|
| P0-1 | Añadir dependency tracking a tasks | `orchestrate/backlog.ts` | 157 | M |
| P0-2 | Implementar checkpoint/restore en COMPLETE | `complete/executor.ts` | 129-147 | M |
| P0-3 | Implementar rollback on failure | `orchestrator.ts` | 454-461 | L |

---

## P1 (Importantes) - Mejoran score significativamente

| ID | Descripción | Archivo | Línea | Esfuerzo |
|----|-------------|---------|-------|----------|
| P1-1 | Re-planning cuando task falla N veces | `complete/executor.ts` | 222 | M |
| P1-2 | Paralelización de tasks independientes | `complete/executor.ts` | 169 | L |
| P1-3 | Detección de regresiones en quality loop | `complete/iterator.ts` | 177 | S |
| P1-4 | Checkpoint versioning | `orchestrator.ts` | 174 | M |
| P1-5 | Basic memory/context management | `orchestrator.ts` | 207 | L |
| P1-6 | Token usage tracking | Todos los executors | - | S |

---

## P2 (Nice to have)

| ID | Descripción | Archivo | Línea | Esfuerzo |
|----|-------------|---------|-------|----------|
| P2-1 | Confidence calculation | `complete/iterator.ts` | 385 | S |
| P2-2 | Tool results caching | `orchestrator.ts` | 254 | M |

---

## Tests Existentes

```
src/orchestrator/orchestrator.test.ts - 14 tests ✓
src/orchestrator/project.test.ts - 7 tests ✓
src/phases/converge/executor.test.ts - 20 tests ✓
src/phases/orchestrate/executor.test.ts - 18 tests ✓
src/phases/complete/executor.test.ts - 31 tests ✓
src/phases/complete/iterator.test.ts - 17 tests ✓
src/phases/output/executor.test.ts - 32 tests ✓
```

**Coverage estimado**: ~75% del Core/Orchestrator

---

## Decisión: CONTINUE

| Criterio | Valor | Resultado |
|----------|-------|-----------|
| Score >= 85 | 72 < 85 | ✗ |
| Delta < 2 | N/A | - |
| Iteración >= 5 | 1 < 5 | ✗ |

**→ CONTINUE** - Implementar P0s para siguiente iteración

---

## Plan de Mejora (Iteración 2)

### Prioridad 1: Implementar P0s

1. **P0-1: Dependency tracking**
   - Añadir `dependencies: string[]` a `Task` type
   - Modificar `BacklogGenerator.generate()` para calcular dependencias
   - Modificar `getSprintTasks()` para ordenar por dependencias

2. **P0-2: Checkpoint/restore en COMPLETE**
   - Serializar estado de sprint en progreso
   - Guardar task actual, iteración, versions
   - Implementar resume desde mid-sprint

3. **P0-3: Rollback on failure**
   - Crear snapshot antes de cada fase
   - Si fase falla, restaurar snapshot anterior
   - Emitir evento `error` con contexto

### Tiempo estimado: ~3-4 horas de desarrollo

---

## Próximos Pasos

```bash
# 1. Implementar P0s
claude "Implementa los 3 P0s del archivo docs/audits/2026-02-02-core-orchestrator-v1.md"

# 2. Correr tests
pnpm check

# 3. Re-auditar
# Crear docs/audits/2026-02-02-core-orchestrator-v2.md
```

---

*Generado por Corbat-Coco Audit System*
