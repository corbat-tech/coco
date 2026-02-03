# Auditoría Providers v1

**Fecha**: 2026-02-02
**Auditor**: Claude Opus 4.5
**Versión**: v0.1.0
**Iteración**: 1
**Score actual**: 73/100
**Status**: CONTINUE

---

## Resumen Ejecutivo

Primera auditoría del sistema de proveedores LLM de Corbat-Coco. Se soportan 4 proveedores con una interfaz unificada. El score inicial de 73/100 indica buena cobertura pero con gaps en retry logic y token counting.

---

## Inventario de Proveedores

| Provider | Archivo | Models Soportados |
|----------|---------|-------------------|
| Anthropic | `anthropic.ts` | Claude Sonnet 4, Opus 4, 3.5 Sonnet/Haiku, 3 Opus/Sonnet/Haiku |
| OpenAI | `openai.ts` | GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-4, GPT-3.5-turbo, o1, o1-mini |
| Gemini | `gemini.ts` | Gemini 2.0 Flash, 1.5 Flash/Pro, 1.0 Pro |
| Kimi | `openai.ts` | Moonshot v1 8k/32k/128k (OpenAI-compatible) |

---

## Evaluación por Criterio

### 1. Provider Coverage (Peso: 25%) - Score: 7/10

| Provider | Estado | Notas |
|----------|--------|-------|
| Anthropic Claude | ✅ | Implementación completa |
| OpenAI GPT | ✅ | Implementación completa |
| Google Gemini | ✅ | Implementación completa |
| Kimi/Moonshot | ✅ | Via OpenAI-compatible |
| **Local models (Ollama)** | ❌ P1 | No implementado |
| Azure OpenAI | ❌ | No implementado |
| AWS Bedrock | ❌ | No implementado |

**Benchmark vs Vercel AI SDK**:
- Vercel AI: Anthropic, OpenAI, Google, Mistral, Cohere, Amazon Bedrock, Azure
- Corbat-Coco: Anthropic, OpenAI, Google, Kimi (falta Mistral, Bedrock, Azure)

### 2. API Design (Peso: 25%) - Score: 8/10

| Aspecto | Estado | Ubicación |
|---------|--------|-----------|
| Unified LLMProvider interface | ✅ | `types.ts:140-191` |
| Consistent type exports | ✅ | `index.ts:6-24` |
| Factory functions | ✅ | `createXxxProvider()` |
| Environment config support | ✅ | `index.ts:58-65` |
| Provider listing | ✅ | `listProviders()` |
| Default provider | ✅ | `getDefaultProvider()` |
| **Provider auto-detection** | ❌ | No auto-detect from API key format |
| **Caching layer** | ❌ | No response caching |

**Interface Quality**:
```typescript
interface LLMProvider {
  id: string;
  name: string;
  initialize(config): Promise<void>;
  chat(messages, options?): Promise<ChatResponse>;
  chatWithTools(messages, options): Promise<ChatWithToolsResponse>;
  stream(messages, options?): AsyncIterable<StreamChunk>;
  countTokens(text): number;
  getContextWindow(): number;
  isAvailable(): Promise<boolean>;
}
```

### 3. Error Handling (Peso: 25%) - Score: 7/10

| Aspecto | Estado | Notas |
|---------|--------|-------|
| Custom ProviderError | ✅ | Con provider, statusCode, retryable |
| Retryable flag | ✅ | Set on 429 y 5xx |
| Status code tracking | ✅ | Anthropic, OpenAI |
| ensureInitialized check | ✅ | All providers |
| **Automatic retry** | ❌ P0 | No retry with backoff |
| **Rate limit handling** | ❌ | No wait-and-retry |

**Error Handling Pattern**:
```typescript
// anthropic.ts:342-358
private handleError(error: unknown): never {
  if (error instanceof Anthropic.APIError) {
    const retryable = error.status === 429 || error.status >= 500;
    throw new ProviderError(error.message, {
      provider: this.id,
      statusCode: error.status,
      retryable,
      cause: error,
    });
  }
  throw new ProviderError(...);
}
```

### 4. Features (Peso: 25%) - Score: 7/10

| Feature | Anthropic | OpenAI | Gemini |
|---------|-----------|--------|--------|
| chat() | ✅ | ✅ | ✅ |
| chatWithTools() | ✅ | ✅ | ✅ |
| stream() | ✅ | ✅ | ✅ |
| countTokens() | ~approx | ~approx | ~approx |
| getContextWindow() | ✅ | ✅ | ✅ |
| isAvailable() | ✅ | ✅ | ✅ |
| Tool choice modes | ✅ | ✅ | ✅ |

| Feature | Estado | Notas |
|---------|--------|-------|
| **Accurate token counting** | ❌ P0 | Using `length/4` approximation |
| **Embeddings** | ❌ | Not implemented |
| Batching | ❌ | Not implemented |
| Vision/images | Partial | Types exist, not all providers |

---

## Cálculo del Score

| Criterio | Peso | Score | Ponderado |
|----------|------|-------|-----------|
| Provider Coverage | 25% | 7/10 | 17.5 |
| API Design | 25% | 8/10 | 20.0 |
| Error Handling | 25% | 7/10 | 17.5 |
| Features | 25% | 7/10 | 17.5 |
| **Total** | 100% | | **72.5 → 73** |

---

## P0: Críticos (bloquean convergencia)

| ID | Descripción | Impacto | Archivo |
|----|-------------|---------|---------|
| P0-1 | Retry with exponential backoff | +5 error handling | Nuevo: `retry.ts` |
| P0-2 | Better token counting (tiktoken for OpenAI) | +3 features | `openai.ts`, `anthropic.ts` |

### P0-1: Retry with Exponential Backoff

```typescript
// Propuesta: src/providers/retry.ts
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  isRetryable: (error: unknown) => boolean
): Promise<T> {
  let lastError: unknown;
  let delay = config.initialDelayMs;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === config.maxRetries) {
        throw error;
      }
      await sleep(delay);
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    }
  }
  throw lastError;
}
```

### P0-2: Better Token Counting

```typescript
// Para OpenAI - usar tiktoken
import { encoding_for_model } from "tiktoken";

countTokens(text: string): number {
  const enc = encoding_for_model(this.config.model ?? "gpt-4o");
  const tokens = enc.encode(text);
  enc.free();
  return tokens.length;
}

// Para Anthropic - usar API de count_tokens si disponible
// Fallback a heurística mejorada (~4.5 chars/token para Claude)
```

---

## P1: Importantes

| ID | Descripción | Impacto |
|----|-------------|---------|
| P1-1 | Local model support (Ollama) | +2 coverage |
| P1-2 | Rate limit handling with backoff | +1 error handling |
| P1-3 | Provider auto-detection | +1 API design |
| P1-4 | Embeddings support | +1 features |

---

## P2: Nice to have

| ID | Descripción |
|----|-------------|
| P2-1 | Response caching layer |
| P2-2 | Azure OpenAI support |
| P2-3 | Batching for multiple requests |
| P2-4 | Cost tracking per request |

---

## Tests

```
pnpm check: PASS
- Typecheck: ✓
- Lint: 0 errors
- Tests: 1216 passed (52 test files)
```

---

## Archivos Auditados

```
src/providers/
├── index.ts       # Exports, createProvider, listProviders
├── types.ts       # LLMProvider interface, Message types
├── anthropic.ts   # Anthropic Claude provider (~375 LOC)
├── openai.ts      # OpenAI + Kimi provider (~430 LOC)
└── gemini.ts      # Google Gemini provider (~420 LOC)
```

---

## Comparación con Benchmarks

| Feature | Corbat-Coco | OpenAI SDK | Vercel AI |
|---------|-------------|------------|-----------|
| Unified interface | ✅ | ✗ (single) | ✅ |
| Multi-provider | ✅ (4) | ✗ (1) | ✅ (7+) |
| Streaming | ✅ | ✅ | ✅ |
| Tool use | ✅ | ✅ | ✅ |
| Retry logic | ❌ | ✅ | ✅ |
| Token counting | ~approx | ✅ (tiktoken) | ✅ |
| Error typing | ✅ | ✅ | ✅ |

---

## Plan de Mejora (Iteración 2)

### Objetivo: Score >= 85 (necesitamos +12)

1. **P0-1: Retry with backoff** (+5 puntos)
   - Crear `src/providers/retry.ts`
   - Integrar en todos los providers
   - Configuración por provider

2. **P0-2: Better token counting** (+3 puntos)
   - Añadir tiktoken para OpenAI
   - Mejorar heurística para Anthropic/Gemini

3. **P1-1: Ollama support** (+2 puntos)
   - Crear OpenAI-compatible wrapper
   - Auto-detect local endpoint

4. **P1-3: Provider auto-detection** (+1 punto)
   - Detectar provider desde formato de API key

---

## Decisión: CONTINUE

| Criterio | Valor | Resultado |
|----------|-------|-----------|
| Score >= 85 | 73 < 85 | ✗ |
| Delta < 2 | N/A (primera iteración) | - |
| Iteración >= 5 | 1 < 5 | ✗ |

**→ CONTINUE** - Implementar P0s para siguiente iteración

---

*Generado por Corbat-Coco Audit System*
