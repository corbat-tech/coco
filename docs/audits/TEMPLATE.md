# Auditoría {ÁREA} - Corbat-Coco v{VERSION}

**Fecha**: YYYY-MM-DD
**Auditor**: {nombre del agente/persona}
**Versión**: v{X.Y.Z}
**Áreas**: {lista de áreas auditadas}
**Score anterior**: {N/A o número}
**Score actual**: {número}/100
**Delta**: {diferencia o N/A}
**Iteración**: #{número}

---

## Resumen ejecutivo

{2-3 oraciones sobre el estado general, mejoras desde última auditoría, y gaps principales}

## Estado de items anteriores

{Solo si hay auditoría previa}

| Item | Prioridad | Estado anterior | Estado actual |
|------|-----------|-----------------|---------------|
| {descripción} | P0 | Pendiente | ✓ Resuelto |
| {descripción} | P0 | Pendiente | ✗ Pendiente |
| {descripción} | P1 | Pendiente | ✓ Resuelto |

## Evaluación por área

### 1. {Área 1}
- **Score**: X/10
- **Implementación**: [Correcto/Parcial/Incorrecto]
- **Archivos**: `{paths relevantes}`
- **Observaciones**:
  - ✓ {cosa bien implementada}
  - ✓ {otra cosa bien}
  - ✗ **{gap crítico}**
  - ✗ {otro gap}

### 2. {Área 2}
- **Score**: X/10
- **Implementación**: [Correcto/Parcial/Incorrecto]
- **Archivos**: `{paths relevantes}`
- **Observaciones**:
  - ✓ {cosa bien implementada}
  - ✗ **{gap crítico}**

{Repetir para cada área}

## Gaps vs Benchmark

| Área | Estado actual | {Benchmark} | Severidad |
|------|---------------|-------------|-----------|
| {feature} | {descripción} | {cómo lo hace el benchmark} | Crítico/Alto/Medio/Bajo |

## Recomendaciones priorizadas

### P0 - Crítico (bloquean funcionalidad básica)

1. **{Título del item}**
   - Descripción: {qué hay que hacer}
   - Archivos: `{paths a modificar}`
   - Esfuerzo estimado: {bajo/medio/alto}

2. **{Título del item}**
   - Descripción: {qué hay que hacer}
   - Archivos: `{paths a modificar}`
   - Esfuerzo estimado: {bajo/medio/alto}

### P1 - Importante (mejora significativa de UX)

3. **{Título del item}**
   - Descripción: {qué hay que hacer}
   - Archivos: `{paths a modificar}`

### P2 - Nice to have

4. **{Título del item}**
   - Descripción: {qué hay que hacer}

## Score global

**Breakdown:**

| Área | Peso | Score | Ponderado |
|------|------|-------|-----------|
| {Área 1} | {X}% | {Y}/10 | {Z} |
| {Área 2} | {X}% | {Y}/10 | {Z} |
| **Total** | 100% | | **{TOTAL}** |

## Decisión de convergencia

- [ ] Score >= 85 → **CONVERGE**
- [ ] Delta < 2 y Score >= 75 → **CONVERGE**
- [ ] Iteración >= 5 → **CONVERGE** (con warning)
- [x] Ninguno de los anteriores → **CONTINUE**

**Siguiente acción**: {CONTINUE: implementar P0s / CONVERGE: cerrar ciclo}

---

## Notas adicionales

{Observaciones que no encajan en otras secciones, contexto relevante, etc.}
