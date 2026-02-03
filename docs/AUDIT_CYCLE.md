# Guía de Auditoría Cíclica - Corbat-Coco

## Patrón: Convergent Quality Iteration (CQI)

Este documento define el proceso de mejora iterativa mediante auditorías sucesivas hasta alcanzar convergencia de calidad.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   AUDIT     │────▶│   IMPROVE   │────▶│   VERIFY    │
│  (Evaluar)  │     │ (Implement) │     │  (Compare)  │
└─────────────┘     └─────────────┘     └─────────────┘
       ▲                                       │
       │         delta < threshold?            │
       │              ┌───┐                    │
       └──────────────│ N │◀───────────────────┘
                      └───┘
                        │ Y
                        ▼
                  ┌───────────┐
                  │  CONVERGE │
                  │   (Done)  │
                  └───────────┘
```

## Parámetros de convergencia

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| `TARGET_SCORE` | 85/100 | Score mínimo aceptable |
| `DELTA_THRESHOLD` | 2 | Delta mínimo entre auditorías para continuar |
| `MAX_ITERATIONS` | 5 | Máximo de ciclos para evitar loops infinitos |
| `MIN_P0_COMPLETE` | 100% | Todos los P0 deben estar resueltos |

## Criterios de parada (cualquiera)

1. **Score alcanzado**: `score >= TARGET_SCORE`
2. **Convergencia**: `|score_n - score_{n-1}| < DELTA_THRESHOLD` (alineado con Corbat-Coco core)
3. **Max iteraciones**: `iteration >= MAX_ITERATIONS`
4. **P0 completados**: Todos los críticos resueltos + score >= 75

---

## Proceso paso a paso

### Fase 1: AUDIT (Evaluar)

**Prompt para el agente auditor:**

```markdown
# Auditoría de Calidad - Corbat-Coco

## Contexto
Lee la última auditoría en `docs/audits/` para entender el estado previo.
Compara con la implementación actual.

## Tu tarea

1. **Lee los archivos relevantes** según el área a auditar
2. **Evalúa cada área** con score 1-10:
   - ¿Están los P0 anteriores resueltos?
   - ¿Hay regresiones?
   - ¿Qué gaps quedan?
3. **Compara con estándares** (Claude Code, Cursor, Aider)
4. **Genera reporte** siguiendo el template en `docs/audits/TEMPLATE.md`

## Output esperado
- Archivo: `docs/audits/YYYY-MM-DD-{area}-v{N}.md`
- Incluir: score anterior, score actual, delta, gaps, recomendaciones

## Reglas
- NO escribas código, solo audita
- Sé objetivo y específico
- Referencia líneas de código exactas
- Prioriza P0 > P1 > P2
```

### Fase 2: IMPROVE (Implementar)

**Prompt para el agente implementador:**

```markdown
# Implementación de Mejoras - Corbat-Coco

## Contexto
Lee la última auditoría en `docs/audits/` (la más reciente por fecha).

## Tu tarea

1. **Identifica items P0** no resueltos
2. **Implementa en orden de prioridad**: P0 primero, luego P1
3. **Por cada fix**:
   - Referencia el item del reporte
   - Explica el cambio
   - Asegura no introducir regresiones

## Reglas
- Solo implementa lo que está en el reporte
- No hagas mejoras "extra" no solicitadas
- Corre tests después de cada cambio significativo
- Si un P0 es muy complejo, divídelo y documenta

## Output esperado
- Código modificado
- Brief de cambios realizados
- Items pendientes si los hay
```

### Fase 3: VERIFY (Comparar)

**Prompt para el agente verificador:**

```markdown
# Verificación Post-Mejoras - Corbat-Coco

## Contexto
Se han implementado mejoras basadas en la auditoría anterior.

## Tu tarea

1. **Verifica cada item P0/P1** marcado como implementado
2. **Busca regresiones** en áreas no tocadas
3. **Calcula nuevo score** usando misma metodología
4. **Determina si continuar**:
   - Si delta < 2 y score >= 75: CONVERGE
   - Si score >= 85: CONVERGE
   - Si iteration >= 5: CONVERGE con warning
   - Else: Nueva iteración

## Output
- Actualiza el reporte de auditoría con verificación
- Indica: CONTINUE o CONVERGE
```

---

## Áreas de auditoría

### UX/REPL (actual)
- **Archivos clave**: `src/cli/repl/**`
- **Benchmark**: Claude Code, Cursor
- **Pesos**: Spinner 25%, Cancel 25%, Confirm 25%, Output 25%

### Core/Orchestrator (futuro)
- **Archivos clave**: `src/orchestrator/**`, `src/phases/**`
- **Benchmark**: AutoGPT, Devin
- **Pesos**: Task planning 30%, Quality loop 30%, Recovery 20%, Context 20%

### Tools (futuro)
- **Archivos clave**: `src/tools/**`
- **Benchmark**: Claude Code tools
- **Pesos**: Completeness 25%, Safety 25%, Performance 25%, UX 25%

### Testing (futuro)
- **Archivos clave**: `src/**/*.test.ts`
- **Benchmark**: 80% coverage target
- **Pesos**: Coverage 40%, Quality 30%, Speed 30%

---

## Tracking de iteraciones

Mantener un log en `docs/audits/ITERATION_LOG.md`:

```markdown
# Iteration Log

| # | Fecha | Área | Score | Delta | Status | Auditor |
|---|-------|------|-------|-------|--------|---------|
| 1 | 2026-02-02 | UX/REPL | 58 | N/A | CONTINUE | Claude Opus |
| 2 | pending | UX/REPL | ? | ? | ? | ? |
```

---

## Comandos útiles

```bash
# Ver última auditoría
ls -la docs/audits/*.md | tail -1

# Comparar scores
grep "Score actual" docs/audits/*.md

# Ver P0 pendientes
grep -A5 "### P0" docs/audits/*.md | grep "✗\|pending"
```

---

## Anti-patrones a evitar

1. **Scope creep**: No agregar features durante mejoras de auditoría
2. **Perfeccionismo**: Parar cuando delta < 3, no buscar 100/100
3. **Regresiones**: Siempre correr tests antes de nueva auditoría
4. **Subjetividad**: Usar criterios medibles, no "se ve mejor"
5. **Loops infinitos**: Respetar MAX_ITERATIONS

---

## Siguiente paso para ti

1. **Crea el iteration log**: `docs/audits/ITERATION_LOG.md`
2. **Ejecuta Fase 2**: Pide a un agente implementar los P0
3. **Ejecuta Fase 3**: Verifica y calcula nuevo score
4. **Repite** hasta convergencia
