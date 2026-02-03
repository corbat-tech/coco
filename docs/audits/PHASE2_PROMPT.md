# Corbat-Coco Audit Phase 2 - Prompt

## Contexto

Corbat-Coco es un agente de coding autónomo con self-review y quality convergence. En la Fase 1 de auditoría se alcanzaron scores de 84-88/100 en todas las áreas. Ahora iniciamos la **Fase 2** para llevar todas las áreas a **95+/100**.

## Tu Tarea

Continuar el ciclo de auditoría CQI (Convergent Quality Iteration) para Corbat-Coco, llevando cada área de su score actual a 95+/100.

## Parámetros Fase 2

| Parámetro | Valor |
|-----------|-------|
| Target Score | **95/100** |
| Delta Threshold | 2 |
| Max Iterations | 5 |

## Estado Actual (Post Fase 1)

| Área | Score Actual | Gap to 95 |
|------|--------------|-----------|
| Testing | 84/100 | -11 |
| UX/REPL | 86/100 | -9 |
| Providers | 86/100 | -9 |
| Config | 87/100 | -8 |
| Core/Orchestrator | 87/100 | -8 |
| Tools | 88/100 | -7 |
| Security | NEW | - |
| Performance | NEW | - |
| Documentation | NEW | - |

## Proceso CQI

Para cada área, seguir el ciclo:

```
AUDIT → IMPROVE → VERIFY → (repeat until converge)
```

### Criterios de Convergencia
1. Score >= 95 ✅
2. Delta < 2 (mejora insuficiente)
3. Iteración >= 5 (max reached)

## Áreas y Criterios de Evaluación

### 1. Testing (84 → 95)
**Pesos:** Coverage 30%, Quality 25%, Organization 25%, CI 20%

**P1s pendientes:**
- Integration tests para flujos completos
- E2E tests con mocks de stdin/stdout
- Coverage CLI commands > 60%
- Coverage total > 80%

### 2. Tools (88 → 95)
**Pesos:** Completeness 25%, Safety 25%, Performance 25%, UX 25%

**P1s pendientes:**
- Streaming para archivos grandes (read_file con chunks)
- Tool composition/chaining
- Timeouts configurables por tool
- Progress callbacks

### 3. Core/Orchestrator (87 → 95)
**Pesos:** State Management 25%, Phase Execution 25%, Error Handling 25%, Extensibility 25%

**P1s pendientes:**
- Parallel task execution real (Promise.all con límite)
- Checkpoints incrementales (no full state cada vez)
- Métricas de performance por fase
- Event system más robusto

### 4. Config (87 → 95)
**Pesos:** Schema Design 25%, Loading 25%, Validation 25%, API 25%

**P1s pendientes:**
- Config file watching (hot reload)
- Config migrations con versioning
- Schema documentation auto-generada
- Validation con mensajes más descriptivos

### 5. Providers (86 → 95)
**Pesos:** API Design 25%, Error Handling 25%, Performance 25%, Extensibility 25%

**P1s pendientes:**
- Streaming responses implementado
- Token counting con tiktoken/real tokenizers
- Cost estimation por request
- Provider health checks

### 6. UX/REPL (86 → 95)
**Pesos:** Responsiveness 25%, Feedback 25%, Error UX 25%, Discoverability 25%

**P1s pendientes:**
- Syntax highlighting para código en output
- Auto-complete para slash commands
- History persistente entre sesiones
- Better progress indicators

### 7. Security (NEW)
**Pesos:** Input Validation 25%, Path Protection 25%, Secrets 25%, Injection Prevention 25%

**Evaluar:**
- Sanitización de inputs en todos los tools
- Protección contra path traversal
- Manejo seguro de API keys y secrets
- Prevención de command injection en bash

### 8. Performance (NEW)
**Pesos:** Startup 25%, Memory 25%, Async 25%, Caching 25%

**Evaluar:**
- Tiempo de startup < 500ms
- Memory footprint razonable
- Operaciones async bien manejadas
- Estrategias de caching donde aplique

### 9. Documentation (NEW)
**Pesos:** API Docs 25%, Code Comments 25%, README 25%, Examples 25%

**Evaluar:**
- JSDoc en funciones públicas
- Comentarios donde la lógica no es obvia
- README completo y actualizado
- Ejemplos de uso

## Archivos Clave

```
docs/audits/ITERATION_LOG.md     # Tracking de todas las iteraciones
docs/audits/AUDIT_CYCLE.md       # Proceso de auditoría
src/                             # Código fuente
vitest.config.ts                 # Config de tests
CLAUDE.md                        # Guidelines del proyecto
```

## Output Esperado

Para cada área auditada:

1. **Documento de auditoría** en `docs/audits/2026-MM-DD-{area}-fase2-v{N}.md`
2. **Código mejorado** implementando los P0s/P1s identificados
3. **Actualización** de `ITERATION_LOG.md` con el progreso
4. **Verificación** con `pnpm check` pasando

## Orden Sugerido

Comenzar por las áreas con mayor gap:
1. Testing (84 → 95) - Mayor gap, impacta confianza
2. UX/REPL (86 → 95) - User-facing
3. Providers (86 → 95) - Core functionality
4. Config (87 → 95)
5. Core/Orchestrator (87 → 95)
6. Tools (88 → 95) - Menor gap
7. Security (NEW) - Critical
8. Performance (NEW)
9. Documentation (NEW)

## Comandos Útiles

```bash
# Verificación completa
pnpm check

# Tests con coverage
pnpm test -- --coverage

# Solo typecheck
pnpm typecheck

# Solo lint
pnpm lint
```

## Notas Importantes

- **NO crear archivos nuevos** a menos que sea absolutamente necesario
- **Preferir editar** código existente
- **Verificar** que `pnpm check` pasa después de cada cambio
- **Documentar** cada mejora en el audit document correspondiente
- El objetivo es **calidad profesional de producción** (95+/100)

---

*Prompt generado para Corbat-Coco Audit Phase 2*
