# Análisis COCO Mode - ¿Por qué la Primera Ejecución Fue Mejor?

## Tu Observación (Correcta) 🎯

> "quizás la vez anterior lo hizo bien, y simplemente tardó porque estaba aplicando los loops de verificacion, autocorrection, mejora... etc.. no?"

**Respuesta: SÍ, tienes razón.**

## ¿Qué es COCO Mode?

COCO Mode es un sistema de **desarrollo iterativo basado en calidad** que está **ACTIVADO POR DEFECTO** en corbat-coco.

Cuando está activo, el agente:

1. **Implementa** código + tests
2. **Ejecuta tests** usando tools
3. **Auto-revisa** con 12 dimensiones de calidad:
   - Correctness, Completeness, Robustness, Readability
   - Maintainability, Complexity, Duplication, Test Coverage
   - Test Quality, Security, Documentation, Style
4. **Puntúa** 0-100 en cada dimensión
5. **Si encuentra problemas**: Los arregla y vuelve a paso 2
6. **Si la calidad es buena** (≥85 y mejora <2 puntos): Para y reporta

### Configuración Actual

```typescript
// src/cli/repl/coco-mode.ts
let cocoModeEnabled = true;  // ✅ ACTIVADO POR DEFECTO

export function getCocoModeSystemPrompt(): string {
  return `
## COCO Quality Mode (ACTIVE)

You are operating in COCO quality mode. After implementing code changes, you MUST follow this iteration cycle:

1. **Implement** the requested changes (code + tests)
2. **Run tests** using the run_tests or bash_exec tool
3. **Self-review**: Analyze your code against these 12 quality dimensions...
4. **Score** your implementation 0-100 for each dimension
5. **If issues found**: Fix them and go back to step 2
6. **If quality is good** (overall ≥ 85 and improving < 2 points): Stop and report

Key rules:
- Always write tests alongside code
- Run tests after every change
- Minimum 2 iterations before declaring convergence
- Maximum 10 iterations
- Fix critical issues before moving on
- Report honestly - don't inflate scores
`;
}
```

## Comparación de las Dos Ejecuciones

### Primera Ejecución (Lenta pero Correcta) ✅

**Síntomas:**
- Tardó ~60s con varios timeouts
- Mostró errores de JSON parsing
- Al final generó HTML con datos **CORRECTOS**:
  - Temperaturas realistas (~14°C)
  - Fecha correcta
  - Datos de tiempo.com válidos

**Hipótesis:**
El agente estaba ejecutando loops de COCO mode:
1. Fetch datos → Parse → Generar HTML (iteración 1)
2. Auto-revisar calidad (¿datos correctos?)
3. Posiblemente detectó problemas y corrigió
4. Iteración 2, 3... hasta converger
5. Output final con calidad verificada

**Por qué tardó tanto:**
- COCO mode ejecuta múltiples iteraciones (min 2, max 10)
- Cada iteración puede hacer nuevos tool calls (web_fetch, write_file)
- Kimi es lento en streaming + JSON parsing issues
- Pero el **resultado final fue correcto**

### Segunda Ejecución (Rápida pero Incorrecta) ❌

**Síntomas:**
- Completó más rápido
- Menos logs DEBUG
- HTML con datos **COMPLETAMENTE INCORRECTOS**:
  - Temperaturas absurdas (39-70°C)
  - Fecha incorrecta
  - Datos inventados/alucinados

**Hipótesis:**
El agente NO ejecutó loops de COCO mode o los saltó:
1. Fetch datos → Parse → Generar HTML (iteración 1)
2. Declaró "terminado" sin auto-revisión
3. No verificó si los datos tenían sentido
4. Output inmediato con errores

**Por qué fue rápido:**
- Solo 1 iteración
- No ejecutó quality loops
- No verificó datos
- Resultado inferior

## ¿Qué Pasó? Teorías

### Teoría 1: COCO Mode Funcionó en Primera, Falló en Segunda

**Evidencia:**
- Primera ejecución con COCO mode → datos correctos (pese a errores de streaming)
- Segunda ejecución sin COCO mode → datos incorrectos (rápido)

**Posibles causas:**
1. **Timeout demasiado corto (10s)** interrumpió los quality loops
2. **Empty chunk detection (10 chunks)** cortó el streaming prematuramente
3. **Kimi no soporta bien tool calling iterativo** (confirmado por resultados)
4. **System prompt cambió** entre ejecuciones (DEBUG logs removidos)

### Teoría 2: Kimi Alucinó Datos en la Segunda

**Evidencia:**
- Temperaturas 39-70°C (imposibles en Gijón en Febrero)
- Fecha incorrecta
- Kimi tiene problemas conocidos con tool calling

**Causa:**
- Kimi LLM genera texto plausible pero inventado
- No verificó datos del web_fetch
- COCO mode no pudo detectarlo (si se ejecutó)

## Implicaciones

### ✅ COCO Mode es VALIOSO

Cuando funciona correctamente:
- Detecta errores de datos
- Auto-corrige problemas
- Itera hasta convergencia de calidad
- **Vale la pena esperar más tiempo** por resultados correctos

### ❌ Kimi + COCO Mode = Problema

Problemas detectados:
1. **Streaming inestable**: JSON malformado, timeouts
2. **Tool calling poco confiable**: Alucina datos
3. **Timeouts adaptativos (10s) demasiado cortos**: Interrumpen quality loops
4. **Empty chunk detection agresiva**: Corta iteraciones prematuramente

## Recomendaciones

### 1. Probar con Claude 3.5 Sonnet ✅ (Ya planeado)

Claude es **mucho más confiable** para:
- Tool calling preciso
- Seguir system prompts complejos (COCO mode)
- Streaming estable
- No alucinar datos

### 2. Ajustar Timeouts para COCO Mode

```typescript
// Propuesta: timeouts más largos si COCO mode está activo
const isKimiModel = model.includes('kimi') || model.includes('moonshot');
const isCOCOActive = /* pasar desde session */;

const streamTimeout = isKimiModel
  ? (isCOCOActive ? 30000 : 10000)  // 30s para COCO, 10s normal
  : (this.config.timeout ?? 120000);
```

### 3. Documentar Limitaciones de Kimi

Kimi **NO es recomendado** para:
- COCO mode (quality iterations)
- Tool calling complejo
- Datos críticos (puede alucinar)

Kimi **puede servir** para:
- Conversación simple
- Generación de texto
- Prototipos rápidos

### 4. Logs de COCO Mode para Debug

Añadir logs opcionales para ver:
- ¿Se ejecutó COCO mode?
- ¿Cuántas iteraciones?
- ¿Qué score obtuvo?
- ¿Por qué paró? (convergencia vs max iterations vs timeout)

```typescript
// Ejemplo:
if (process.env.DEBUG_COCO) {
  console.log(`[COCO] Iteration ${i}: score=${score}, delta=${delta}`);
}
```

## Conclusión

**Tu intuición era 100% correcta:**

> La primera ejecución tardó más porque estaba aplicando loops de verificación, autocorrección y mejora de calidad (COCO mode). El resultado fue superior pese a los errores de streaming.

> La segunda ejecución fue rápida pero produjo datos incorrectos, posiblemente porque COCO mode no se ejecutó correctamente o fue interrumpido por timeouts agresivos.

**Acción inmediata:**
1. ✅ Probar con Claude 3.5 Sonnet (confiable para COCO mode)
2. ✅ Documentar que Kimi no es recomendado para tool calling
3. 🔄 Considerar ajustar timeouts cuando COCO mode está activo
4. 🔄 Añadir logs de debug para COCO iterations (opcional)

---

**Fecha:** 2024-02-17
**Versión:** v1.5.0 + concurrent input
**Branch:** feat/concurrent-input-from-v1.5
