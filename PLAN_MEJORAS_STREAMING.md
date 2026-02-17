# Plan de Mejoras: Streaming de Tool Calls con Kimi

## Estado Actual
- ✅ El resultado final es correcto (HTML perfecto)
- ❌ Hay errores de parsing que causan timeouts
- ❌ Experiencia de usuario degradada (60s esperando)
- ❌ Logs de debug no aparecen cuando deberían

## Problemas Identificados

### 1. **Streaming Incompleto de Kimi** (P0 - Crítico)
**Síntoma**: Stream se cuelga esperando más chunks que nunca llegan
**Causa**: Kimi no cierra el stream correctamente o envía chunks vacíos
**Impacto**: Timeout de 60s+ antes de continuar

### 2. **Parsing de Arguments Fallido** (P1 - Alto)
**Síntoma**: `Failed to parse tool call arguments`
**Causa**: JSON incompleto o malformado del stream
**Impacto**: Error visible al usuario, confusión

### 3. **Falta de Feedback Visual** (P1 - Alto)
**Síntoma**: Usuario no sabe si está progresando
**Causa**: Logs de debug no visibles, spinner genérico
**Impacto**: Mala UX, sensación de colgado

---

## Soluciones Propuestas

### Fase 1: Detección y Recuperación Rápida (Inmediato)
**Objetivo**: Detectar cuando Kimi se cuelga y recuperar rápidamente

#### 1.1. Timeout Adaptativo para Kimi
```typescript
// En openai.ts, detectar modelos Kimi
const isKimiModel = model.includes('kimi') || model.includes('moonshot');
const streamTimeout = isKimiModel ? 10000 : 120000; // 10s para Kimi, 120s otros
```

**Beneficio**: Recuperación en 10s en lugar de 120s

#### 1.2. Detección de Stream Vacío
```typescript
let emptyChunksCount = 0;
const MAX_EMPTY_CHUNKS = 5;

for await (const chunk of stream) {
  if (!delta?.content && !delta?.tool_calls && !delta?.finish_reason) {
    emptyChunksCount++;
    if (emptyChunksCount > MAX_EMPTY_CHUNKS) {
      console.warn('[Kimi] Stream appears stuck, finalizing early');
      break;
    }
  } else {
    emptyChunksCount = 0;
  }
}
```

**Beneficio**: Detecta stream colgado en 5 chunks vacíos (~500ms)

#### 1.3. Parsing Robusto con Fallback
```typescript
let input: Record<string, unknown> = {};
try {
  input = builder.arguments ? JSON.parse(builder.arguments) : {};
} catch (error) {
  // NUEVO: Intentar reparar JSON incompleto
  const repaired = attemptJsonRepair(builder.arguments);
  if (repaired) {
    input = repaired;
  } else {
    console.error(`[${builder.name}] Cannot parse arguments, using empty object`);
  }
}
```

**Beneficio**: Mayor tasa de éxito, menos errores visibles

---

### Fase 2: Mejor Feedback Visual (Corto plazo)
**Objetivo**: Usuario siempre sabe qué está pasando

#### 2.1. Spinner con Progreso Real
```typescript
// En lugar de: "Preparing: write_file..."
// Mostrar: "Preparing: write_file... (receiving 1.2KB)"

const bytesReceived = builder.arguments.length;
const progressMsg = bytesReceived > 0
  ? `(receiving ${formatBytes(bytesReceived)})`
  : '(waiting for data)';

options.onToolPreparing?.(`${toolName} ${progressMsg}`);
```

**Beneficio**: Usuario ve progreso activo

#### 2.2. Mensaje de Recuperación
```typescript
if (parseError) {
  console.log(chalk.yellow(`⚠️  ${toolName}: Incomplete data, retrying...`));
}
```

**Beneficio**: Transparencia sobre qué está pasando

---

### Fase 3: Optimizaciones de Kimi (Mediano plazo)
**Objetivo**: Kimi funciona de forma óptima

#### 3.1. Desactivar Thinking para Tool Calls
```typescript
private getExtraBody(model: string): Record<string, unknown> | undefined {
  if (this.needsThinkingDisabled(model)) {
    return {
      thinking: { type: "disabled" },
      // NUEVO: Optimizar para tool calls
      stream_options: { include_usage: false }, // Reduce overhead
    };
  }
}
```

#### 3.2. Usar Non-Streaming para Tools Grandes
```typescript
// Si el tool tiene mucho contenido esperado (>5KB), usar no-streaming
const usesLargeContent = toolCall.name === 'write_file' || toolCall.name === 'edit_file';
if (isKimiModel && usesLargeContent) {
  // Usar chatWithTools (no streaming) en lugar de streamWithTools
  const result = await provider.chatWithTools(messages, options);
  // Procesar de una vez
}
```

**Beneficio**: Evitar streaming problemático para casos específicos

---

### Fase 4: Arquitectura Alternativa (Largo plazo)
**Objetivo**: Sistema robusto independiente del provider

#### 4.1. Circuit Breaker para Providers Problemáticos
```typescript
class StreamHealthMonitor {
  private failures = new Map<string, number>();

  shouldUseStreaming(provider: string, model: string): boolean {
    const key = `${provider}:${model}`;
    const failureCount = this.failures.get(key) || 0;

    // Después de 3 fallos, cambiar a non-streaming
    return failureCount < 3;
  }

  recordFailure(provider: string, model: string) {
    const key = `${provider}:${model}`;
    this.failures.set(key, (this.failures.get(key) || 0) + 1);
  }
}
```

**Beneficio**: Adaptación automática según comportamiento del provider

#### 4.2. Retry con Non-Streaming
```typescript
try {
  // Intentar streaming primero
  return await streamWithTools(messages, options);
} catch (error) {
  if (isStreamingError(error)) {
    console.log(chalk.yellow('Stream failed, retrying without streaming...'));
    // Fallback a non-streaming
    return await chatWithTools(messages, options);
  }
  throw error;
}
```

**Beneficio**: Robustez automática

---

## Priorización y Timeline

### ✅ **Semana 1: Quick Wins** (Fase 1)
- [ ] Timeout adaptativo 10s para Kimi
- [ ] Detección de stream vacío
- [ ] Parsing robusto con json-repair
- [ ] **Resultado esperado**: Recuperación en <10s, 90% menos errores

### ✅ **Semana 2: UX** (Fase 2)
- [ ] Spinner con bytes recibidos
- [ ] Mensajes de recuperación
- [ ] Logging mejorado para debug
- [ ] **Resultado esperado**: Usuario informado, confianza en el sistema

### 🔄 **Mes 1: Optimizaciones** (Fase 3)
- [ ] Extra body optimizado para Kimi
- [ ] Detección de tools grandes → non-streaming
- [ ] Testing con diferentes modelos
- [ ] **Resultado esperado**: Kimi funciona de forma óptima

### 🔮 **Mes 2-3: Robustez** (Fase 4)
- [ ] Circuit breaker
- [ ] Retry automático con fallback
- [ ] Métricas de salud por provider
- [ ] **Resultado esperado**: Sistema auto-adaptativo

---

## Métricas de Éxito

### Antes (Estado Actual)
- ⏱️ **Tiempo de espera**: 60-120s cuando falla
- ❌ **Tasa de error visible**: ~50% (errores de parsing)
- 😕 **Satisfacción UX**: Baja (no sabe qué pasa)
- ✅ **Tasa de éxito final**: 100% (eventualmente funciona)

### Después (Objetivo)
- ⏱️ **Tiempo de espera**: <10s cuando falla
- ❌ **Tasa de error visible**: <5% (solo casos extremos)
- 😊 **Satisfacción UX**: Alta (feedback claro)
- ✅ **Tasa de éxito final**: 100% (más rápido y limpio)

---

## Notas de Implementación

### Librerías Útiles
- `json-repair`: Para reparar JSON malformado automáticamente
- `p-timeout`: Para timeouts más granulares

### Tests Necesarios
1. Test con Kimi enviando JSON incompleto
2. Test con stream que se cuelga
3. Test con múltiples tool calls simultáneos
4. Test de fallback streaming → non-streaming

### Consideraciones
- Kimi k2.5 es un modelo nuevo, pueden haber bugs del lado del provider
- Considerar reportar issue al equipo de Moonshot/Kimi
- Documentar workarounds para otros usuarios

---

## Conclusión

El resultado final es **excelente** (HTML perfecto), pero la experiencia durante la ejecución es **mejorable**.

**Prioridad**: Implementar Fase 1 (Quick Wins) **esta semana** para reducir frustración del usuario de 60s → 10s.
