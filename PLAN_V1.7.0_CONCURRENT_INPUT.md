# Plan de Desarrollo v1.7.0 - Concurrent Input (Para Ejecución por Agentes)

## 📋 Contexto del Proyecto

**Proyecto:** Corbat-Coco (Autonomous Coding Agent)
**Versión Actual:** v1.6.0
**Objetivo v1.7.0:** Implementar Concurrent Input robusto y testeado
**Branch Base:** `main` (commit `ed259d1`)
**Branch de Trabajo:** `feat/concurrent-input-v1.7.0`

---

## 🎯 Objetivo Principal

Permitir al usuario enviar mensajes/instrucciones MIENTRAS el agente está ejecutando (pensando, ejecutando tools, iterando en COCO mode), sin romper la UI ni causar spinners duplicados.

**Problema Anterior (v1.6.0):**
- Concurrent input implementado pero no funcionaba
- Usuario no podía escribir durante ejecución del agente
- Conflictos entre raw mode, Ora spinner y stdout

**Solución v1.7.0:**
- Implementación incremental en 4 fases
- Testing exhaustivo en cada fase
- Arquitectura basada en spike técnico
- Quality loops con múltiples agentes

---

## 🤖 Metodología Multi-Agente (CRITICAL)

Este proyecto DEBE ejecutarse siguiendo el patrón de múltiples agentes especializados:

### **Ciclo de Desarrollo por Feature:**

```
┌─────────────────────────────────────────────────────────┐
│  1. PLAN AGENT    → Planifica implementación           │
│  2. ARCH AGENT    → Diseña arquitectura detallada      │
│  3. DEV AGENT     → Implementa código + tests          │
│  4. REVIEW AGENT  → Analiza código y da score 0-100    │
│  5. IMPROVE AGENT → Planifica mejoras específicas      │
│  6. Loop 3-5 hasta: score >= 85 y delta < 2           │
└─────────────────────────────────────────────────────────┘
```

### **Instrucciones para Cada Agente:**

#### **PLAN AGENT (Agente 1)**
**Input:** Descripción de la feature/fase
**Responsabilidades:**
- Analizar requisitos
- Identificar dependencias
- Crear lista de tareas específicas
- Estimar complejidad y riesgos
- Definir criterios de éxito

**Output:** Plan detallado de implementación en formato markdown

**Ejemplo de Prompt:**
```
Eres el PLAN AGENT. Tu tarea es planificar la implementación de [FEATURE].

Contexto del proyecto:
- Proyecto: Corbat-Coco
- Versión: v1.7.0
- Feature: [NOMBRE DE LA FEATURE]
- Restricciones: [LIMITACIONES TÉCNICAS]

Debes generar:
1. Lista de tareas específicas (granulares, implementables)
2. Orden de ejecución
3. Dependencias entre tareas
4. Riesgos identificados
5. Criterios de éxito medibles

Formato de salida: Markdown con secciones claramente delimitadas.
```

---

#### **ARCH AGENT (Agente 2)**
**Input:** Plan de implementación del PLAN AGENT
**Responsabilidades:**
- Diseñar arquitectura de archivos/módulos
- Definir interfaces y contratos
- Especificar patrones de diseño a usar
- Identificar trade-offs técnicos
- Crear ADR (Architecture Decision Record)

**Output:** Documento de arquitectura + ADR

**Ejemplo de Prompt:**
```
Eres el ARCH AGENT. Tu tarea es diseñar la arquitectura para [FEATURE].

Input (del PLAN AGENT):
[PEGAR PLAN AQUÍ]

Contexto del proyecto:
- Stack: TypeScript, Node.js, ESM
- Patterns existentes: [DESCRIBIR]
- Limitaciones: [TÉCNICAS Y DE DISEÑO]

Debes generar:
1. Estructura de archivos y módulos
2. Interfaces TypeScript (sin implementación)
3. Diagramas de flujo (formato mermaid)
4. ADR con decisiones clave
5. Trade-offs y alternativas consideradas

Formato de salida: Markdown + código TypeScript (solo interfaces/types)
```

---

#### **DEV AGENT (Agente 3)**
**Input:** Arquitectura del ARCH AGENT
**Responsabilidades:**
- Implementar código según la arquitectura
- Escribir tests unitarios (coverage >80%)
- Seguir coding standards del proyecto (ver CLAUDE.md)
- Documentar código con JSDoc
- Asegurar type safety (TypeScript strict mode)

**Output:** Código implementado + tests

**Ejemplo de Prompt:**
```
Eres el DEV AGENT. Tu tarea es implementar [FEATURE] según la arquitectura.

Input (del ARCH AGENT):
[PEGAR ARQUITECTURA AQUÍ]

Contexto del proyecto:
- Ver: CLAUDE.md (coding guidelines)
- Stack: TypeScript ESM, Node.js 22+
- Testing: Vitest
- Linting: oxlint
- Format: oxfmt

Requisitos CRÍTICOS:
1. TypeScript strict mode (sin any)
2. Tests con coverage >80%
3. Imports con extensión .js
4. JSDoc comments en funciones públicas
5. Manejo de errores robusto

Implementa:
1. Código funcional completo
2. Tests unitarios (.test.ts)
3. Manejo de edge cases
4. Documentación inline

Formato de salida: Archivos TypeScript listos para commit
```

---

#### **REVIEW AGENT (Agente 4)**
**Input:** Código implementado por DEV AGENT
**Responsabilidades:**
- Analizar código contra 12 dimensiones de calidad
- Dar score 0-100 por dimensión
- Identificar problemas específicos (no generales)
- Proveer evidencia concreta (líneas de código)
- Calcular score global

**Output:** Reporte de revisión con scores

**12 Dimensiones de Calidad:**
1. **Correctness** - ¿Funciona según spec?
2. **Completeness** - ¿Implementa todo lo requerido?
3. **Robustness** - ¿Maneja edge cases y errores?
4. **Readability** - ¿Código claro y entendible?
5. **Maintainability** - ¿Fácil de modificar?
6. **Complexity** - ¿Evita complejidad innecesaria?
7. **Duplication** - ¿Sin código duplicado?
8. **Test Coverage** - ¿Tests >80%?
9. **Test Quality** - ¿Tests significativos?
10. **Security** - ¿Sin vulnerabilidades?
11. **Documentation** - ¿Bien documentado?
12. **Style** - ¿Sigue convenciones?

**Ejemplo de Prompt:**
```
Eres el REVIEW AGENT. Tu tarea es revisar la implementación de [FEATURE].

Input (del DEV AGENT):
[PEGAR CÓDIGO AQUÍ]

Debes analizar el código contra 12 dimensiones de calidad:
[LISTAR LAS 12 DIMENSIONES]

Para CADA dimensión:
1. Score 0-100
2. Justificación con evidencia concreta
3. Problemas específicos encontrados (con líneas de código)
4. Sugerencias de mejora accionables

Calcula:
- Score global (promedio de las 12 dimensiones)
- Dimensiones críticas (score <70)
- Dimensiones que necesitan mejora (score <85)

Formato de salida:
```markdown
## Review Report - [FEATURE]

### Global Score: [SCORE]/100

### Dimension Scores:
1. Correctness: [SCORE]/100 - [JUSTIFICACIÓN]
   - Issues: [LISTA DE PROBLEMAS ESPECÍFICOS]

[... resto de dimensiones ...]

### Critical Issues (Must Fix):
- [PROBLEMA 1 con línea de código]
- [PROBLEMA 2 con línea de código]

### Improvement Suggestions:
- [SUGERENCIA 1]
- [SUGERENCIA 2]

### Verdict: PASS / NEEDS_WORK
```
```

---

#### **IMPROVE AGENT (Agente 5)**
**Input:** Review report del REVIEW AGENT
**Responsabilidades:**
- Analizar problemas identificados
- Priorizar mejoras (críticas primero)
- Crear plan de acción específico
- Proveer snippets de código corregido
- Estimar impacto de cada mejora

**Output:** Plan de mejoras con código específico

**Ejemplo de Prompt:**
```
Eres el IMPROVE AGENT. Tu tarea es planificar mejoras para [FEATURE].

Input (del REVIEW AGENT):
[PEGAR REVIEW REPORT AQUÍ]

Debes generar un plan de mejoras que:
1. Priorice issues críticos (score <70)
2. Provea soluciones concretas (con código)
3. Estime impacto en cada dimensión
4. Sea implementable por el DEV AGENT

Para cada mejora:
- Problema específico
- Solución propuesta (con snippet de código)
- Dimensiones que mejora
- Impacto estimado en score (+X puntos)

Formato de salida:
```markdown
## Improvement Plan - [FEATURE]

### Current Score: [SCORE]/100
### Target Score: >=85/100

### Priority 1 - Critical Fixes:
1. **[PROBLEMA]**
   - Dimensión afectada: [NOMBRE]
   - Solución:
   ```typescript
   // Código corregido aquí
   ```
   - Impacto estimado: +[X] puntos

[... más fixes ...]

### Priority 2 - Improvements:
[... mejoras no críticas ...]

### Estimated Final Score: [SCORE]/100
```
```

---

## 🔄 Loop de Convergencia de Calidad

**CRÍTICO:** Debes iterar entre DEV → REVIEW → IMPROVE → DEV hasta convergencia.

### **Criterios de Convergencia:**

```typescript
interface ConvergenceCriteria {
  minScore: 85;           // Score global mínimo
  maxIterations: 10;      // Máximo de iteraciones
  convergenceThreshold: 2; // Delta mínimo entre iteraciones
}
```

### **Algoritmo:**

```
scores = []
iteration = 0

while (iteration < maxIterations):
  iteration++

  // DEV AGENT: Implementa (o mejora)
  code = dev_agent.implement(improvement_plan)

  // REVIEW AGENT: Analiza
  review = review_agent.analyze(code)
  scores.append(review.globalScore)

  // Check convergencia
  if (review.globalScore >= 85):
    if (iteration >= 2):  // Mínimo 2 iteraciones
      delta = scores[-1] - scores[-2]
      if (abs(delta) < 2):
        print("✅ CONVERGED at score:", review.globalScore)
        break

  // IMPROVE AGENT: Planifica mejoras
  improvement_plan = improve_agent.plan(review)

if (iteration >= maxIterations):
  print("⚠️ MAX ITERATIONS reached. Final score:", scores[-1])
```

### **Output Esperado:**

```
Iteration 1: Score 72/100
Iteration 2: Score 81/100 (delta: +9)
Iteration 3: Score 86/100 (delta: +5)
Iteration 4: Score 87/100 (delta: +1)
✅ CONVERGED at score: 87/100
```

---

## 📐 Fases de Desarrollo

### **FASE 1: Research & Spike (Spike Técnico)**

#### **1.1. PLAN AGENT - Planificación del Spike**

**Task:** Planificar investigación técnica de soluciones para concurrent input

**Prompt para PLAN AGENT:**
```
Planifica un spike técnico para evaluar soluciones de concurrent input.

Requisitos:
- Debe funcionar con Ora spinner (ya en uso)
- Terminal raw mode para capturar input
- No interferir con stdout/stderr del agente
- Soporte para stdin en modo no-bloqueante

Opciones a evaluar:
1. Ink (React para terminal)
2. Blessed (TUI framework)
3. terminal-kit (Input handling)
4. Custom implementation (raw mode manual)

Debes planificar:
- Criterios de evaluación
- Prototipos mínimos a crear
- Métricas a medir
- Documentación a generar
```

**Output Esperado:**
- `PLAN_SPIKE_CONCURRENT_INPUT.md`

---

#### **1.2. DEV AGENT - Implementar Prototipos**

**Task:** Crear 4 prototipos mínimos (uno por opción)

**Prompt para DEV AGENT:**
```
Implementa 4 prototipos en `spike/concurrent-input/`:

1. `01-ink-prototype.ts` - Usando Ink
2. `02-blessed-prototype.ts` - Usando Blessed
3. `03-terminal-kit-prototype.ts` - Usando terminal-kit
4. `04-custom-raw-mode.ts` - Custom con raw mode

Cada prototipo debe:
- Mostrar un spinner (con Ora o equivalente)
- Capturar input del usuario
- Mostrar el input capturado
- NO romper el spinner

Incluye script de testing manual: `spike/test-prototypes.sh`
```

**Output Esperado:**
- 4 archivos de prototipo
- Script de testing
- `spike/RESULTS.md` con hallazgos

---

#### **1.3. REVIEW AGENT - Evaluar Prototipos**

**Task:** Comparar prototipos y recomendar solución

**Prompt para REVIEW AGENT:**
```
Evalúa los 4 prototipos de concurrent input.

Criterios de evaluación:
1. Compatibilidad con Ora (0-100)
2. Facilidad de implementación (0-100)
3. Performance (0-100)
4. Robustez (0-100)
5. Tamaño de dependencia (0-100)
6. Mantenibilidad (0-100)

Para cada prototipo:
- Score en cada criterio
- Pros y contras
- Riesgos identificados

Recomendación final:
- Cuál usar para v1.7.0
- Justificación técnica
```

**Output Esperado:**
- `spike/EVALUATION.md` con scores y recomendación

---

#### **1.4. ARCH AGENT - Crear ADR**

**Task:** Documentar decisión arquitectónica

**Prompt para ARCH AGENT:**
```
Crea ADR-007 basado en la evaluación del spike.

Formato ADR:
- Título
- Status: Accepted
- Context: Problema que resolvemos
- Decision: Qué solución elegimos
- Consequences: Trade-offs, pros/cons
- Alternatives: Opciones descartadas

Archivo: `docs/architecture/adrs/007-concurrent-input-architecture.md`
```

**Output Esperado:**
- ADR-007 documentado

---

### **FASE 2: MVP - Captura Básica**

#### **2.1. PLAN AGENT - Planificar MVP**

**Prompt para PLAN AGENT:**
```
Planifica MVP de concurrent input basado en la solución elegida en ADR-007.

Requisitos:
- Capturar stdin sin mostrar caracteres
- Queue simple de mensajes
- NO mostrar feedback durante captura (evitar conflictos)
- Funciona con Ora spinner

Tareas a definir:
1. Estructura de archivos
2. Interfaces TypeScript
3. Tests requeridos
4. Integration points con REPL existente

Criterios de éxito:
- Usuario puede escribir + Enter durante ejecución
- Mensajes se almacenan en queue
- No rompe spinner
- Tests pasan (coverage >80%)
```

**Output Esperado:**
- `PLAN_MVP_CONCURRENT_INPUT.md`

---

#### **2.2. ARCH AGENT - Diseñar Arquitectura MVP**

**Prompt para ARCH AGENT:**
```
Diseña arquitectura para MVP de concurrent input.

Archivos a crear:
- `src/cli/repl/input/concurrent-capture-v2.ts`
- `src/cli/repl/input/message-queue.ts`
- `src/cli/repl/input/types.ts`

Define:
1. Interfaces TypeScript (solo interfaces, no implementación):
   - ConcurrentCaptureState
   - MessageQueue
   - QueuedMessage
   - CaptureConfig

2. Diagrama de flujo (mermaid):
   - Cómo se inicia captura
   - Cómo se captura input
   - Cómo se almacena en queue
   - Cómo se detiene captura

3. Integration points:
   - Dónde se llama startCapture() en index.ts
   - Dónde se llama stopCapture()
   - Cómo se accede a la queue

Restricciones:
- NO usar console.log (interfiere con spinner)
- NO usar process.stdout.write directamente
- SÍ usar eventos de Node.js
```

**Output Esperado:**
- `ARCH_MVP_CONCURRENT_INPUT.md` con interfaces + diagramas

---

#### **2.3. DEV AGENT → REVIEW AGENT → IMPROVE AGENT → Loop**

**Prompt para DEV AGENT (Primera Iteración):**
```
Implementa MVP de concurrent input según arquitectura.

Archivos a crear:
1. src/cli/repl/input/concurrent-capture-v2.ts
2. src/cli/repl/input/message-queue.ts
3. src/cli/repl/input/types.ts
4. src/cli/repl/input/concurrent-capture-v2.test.ts
5. src/cli/repl/input/message-queue.test.ts

Requisitos:
- TypeScript strict mode
- Coverage >80%
- JSDoc comments
- Manejo de errores robusto
- NO console.log

Sigue interfaces del ARCH AGENT.
```

**Luego ejecutar loop:**
1. DEV AGENT implementa
2. REVIEW AGENT analiza (12 dimensiones)
3. Si score <85 o delta >=2: IMPROVE AGENT + volver a DEV
4. Si score >=85 y delta <2: CONVERGED ✅

**Output Esperado:**
- Código con score >=85
- Tests pasando
- `REVIEW_MVP_ITERATION_[N].md` por cada iteración

---

#### **2.4. Integración con REPL**

**Prompt para DEV AGENT:**
```
Integra concurrent-capture-v2 en src/cli/repl/index.ts

Cambios requeridos:
1. Import de concurrent-capture-v2
2. Llamar startCapture() después de inputHandler.pause()
3. Llamar stopCapture() después de executeAgentTurn()
4. NO procesar mensajes aún (solo captura)

Tests de integración:
- Crear test que ejecuta REPL mock con captura activa
- Verificar que no interfiere con spinner
- Verificar que queue recibe mensajes
```

**Loop:** DEV → REVIEW → IMPROVE hasta convergencia

---

### **FASE 3: Feedback Visual**

#### **3.1. PLAN AGENT - Planificar Feedback**

**Prompt para PLAN AGENT:**
```
Planifica sistema de feedback para mensajes capturados.

Problema:
- Usuario escribe mensaje pero no ve confirmación
- No puede usar console.log (rompe spinner)

Opciones a evaluar:
1. Escribir a archivo + tail -f en otra terminal
2. Log separado a stderr con timestamp
3. Notification system (macOS: osascript, Linux: notify-send)
4. Beep/bell cuando se captura (más simple)
5. Status bar separado (debajo del spinner)

Define:
- Criterios de evaluación
- Prototipo a crear para cada opción
- Métricas de éxito
```

**Output:**
- `PLAN_FEEDBACK_VISUAL.md`

---

#### **3.2. DEV AGENT - Prototipos de Feedback**

**Prompt:**
```
Crea prototipos de feedback en `spike/feedback/`:

1. `01-file-logging.ts` - Log a archivo
2. `02-stderr-logging.ts` - Log a stderr
3. `03-notification.ts` - OS notifications
4. `04-beep.ts` - Simple beep
5. `05-status-bar.ts` - Barra de estado

Cada prototipo:
- Funciona con Ora spinner activo
- Muestra confirmación de mensaje capturado
- NO rompe el spinner

Testing manual: `spike/feedback/test.sh`
```

---

#### **3.3. REVIEW AGENT - Evaluar Feedback**

**Prompt:**
```
Evalúa los 5 prototipos de feedback.

Criterios:
1. UX (¿usuario ve confirmación?)
2. No interferencia con spinner
3. Cross-platform (macOS + Linux)
4. Simplicidad de implementación
5. Performance

Recomienda el mejor approach.
```

---

#### **3.4. ARCH AGENT + DEV AGENT + Loop**

Implementar solución elegida con quality loop hasta score >=85.

**Output Esperado:**
- Feedback system implementado
- Tests pasando
- Score >=85

---

### **FASE 4: Procesamiento Inteligente**

#### **4.1. PLAN AGENT - Planificar Procesamiento**

**Prompt:**
```
Planifica procesamiento inteligente de interrupciones.

Tipos de interrupciones:
1. Abort ("para", "stop", "cancela") → Abortar ejecución inmediata
2. Modificación ("añade X", "cambia Y") → Aplicar al final
3. Corrección ("error en Z", "arregla W") → Queue para después
4. Información ("usa emoji", "más corto") → Context para siguiente

Define:
- Clasificador de interrupciones (LLM o regex?)
- Cómo aplicar cada tipo
- Manejo de contexto
```

---

#### **4.2. ARCH AGENT - Diseñar Clasificador**

**Prompt:**
```
Diseña clasificador de interrupciones.

Archivos:
- src/cli/repl/interruptions/classifier.ts
- src/cli/repl/interruptions/processor.ts
- src/cli/repl/interruptions/types.ts

Interfaces:
- InterruptionType (enum: Abort, Modify, Correct, Info)
- InterruptionClassifier
- InterruptionProcessor

Diagrama de flujo completo.
```

---

#### **4.3. DEV AGENT + Loop hasta Convergencia**

Implementar clasificador + processor con quality loop.

---

#### **4.4. Integración Final + Tests E2E**

**Prompt para DEV AGENT:**
```
Integra procesamiento completo en REPL.

Tests E2E:
1. test/e2e/concurrent-input-abort.test.ts
2. test/e2e/concurrent-input-modify.test.ts
3. test/e2e/concurrent-input-multiple.test.ts

Cada test:
- Simula ejecución larga
- Envía interrupciones
- Verifica comportamiento correcto
```

**Loop hasta score >=85**

---

## ✅ Criterios de Éxito Global (v1.7.0)

### **Funcionales:**
- ✅ Usuario puede escribir durante ejecución del agente
- ✅ Mensajes se capturan sin romper spinner
- ✅ Feedback visual funciona en macOS y Linux
- ✅ Clasificador identifica tipos de interrupción correctamente
- ✅ Abort funciona (detiene ejecución)
- ✅ Modificaciones se aplican al final
- ✅ Contexto se preserva

### **Calidad:**
- ✅ Test coverage >80% en todos los módulos
- ✅ Score global >=85 en todas las fases
- ✅ No hay spinners duplicados
- ✅ No hay corrupción de output
- ✅ Performance <50ms overhead

### **Documentación:**
- ✅ ADR-007 (arquitectura)
- ✅ ADR-008 (feedback mechanism)
- ✅ User guide actualizado
- ✅ Known limitations documentadas
- ✅ Review reports de todas las fases

---

## 🧪 Plan de Testing Manual (Para Validación Final)

Después de completar las 4 fases, ejecutar estos tests manuales:

### **Test 1: Captura Básica**
```bash
pnpm dev

# Ejecutar comando largo
> Busca en la web las últimas noticias sobre IA y crea un resumen detallado en markdown

# MIENTRAS ejecuta:
# - Escribe: "hazlo más corto"
# - Presiona Enter
# - Deberías ver confirmación de captura
# - NO debería romper el spinner
```

**Criterios de éxito:**
- ✅ Puedes escribir sin ver los caracteres
- ✅ Al presionar Enter, ves confirmación
- ✅ Spinner sigue funcionando correctamente
- ✅ Al final, el agente procesa tu mensaje

---

### **Test 2: Múltiples Interrupciones**
```bash
> Crea un archivo HTML con información del clima de 5 ciudades españolas

# MIENTRAS ejecuta:
# - Mensaje 1: "añade emojis"
# - Mensaje 2: "usa colores azules"
# - Mensaje 3: "título más grande"
```

**Criterios de éxito:**
- ✅ Los 3 mensajes se capturan
- ✅ Se procesan en orden
- ✅ El resultado final incluye las 3 modificaciones

---

### **Test 3: Abort Durante Ejecución**
```bash
> Busca información sobre 50 países y crea un archivo markdown con todos

# MIENTRAS ejecuta (aprox 10s después):
# - Escribe: "para"
# - Presiona Enter
```

**Criterios de éxito:**
- ✅ La ejecución se aborta inmediatamente
- ✅ Se muestra mensaje de cancelación
- ✅ No se genera el archivo completo
- ✅ REPL vuelve a estar disponible

---

### **Test 4: COCO Mode + Interrupciones**
```bash
# Verificar que COCO mode está ON
/coco status

> Crea una función TypeScript que calcule fibonacci con memoization

# MIENTRAS está en "Running quality checks..." o "Iterating for quality...":
# - Escribe: "añade tests unitarios completos"
```

**Criterios de éxito:**
- ✅ Mensaje se captura durante iteración de calidad
- ✅ COCO mode completa sus iteraciones
- ✅ Al final, procesa el mensaje y añade tests
- ✅ Score de calidad sigue siendo >=85

---

### **Test 5: Compatibilidad Cross-Platform**

**En macOS:**
```bash
pnpm dev
# Ejecutar Test 1, 2, 3
```

**En Linux (Docker o VM):**
```bash
pnpm dev
# Ejecutar Test 1, 2, 3
```

**Criterios de éxito:**
- ✅ Funciona igual en ambas plataformas
- ✅ Feedback visual funciona en ambas
- ✅ No hay errores específicos de plataforma

---

### **Test 6: Performance**
```bash
# Ejecutar con Node.js profiler
node --prof dist/cli/index.js

# Ejecutar comando largo + múltiples interrupciones
> [COMANDO LARGO]
# Enviar 10 interrupciones durante ejecución

# Analizar profile
node --prof-process isolate-*.log > profile.txt
```

**Criterios de éxito:**
- ✅ Overhead de concurrent input <50ms
- ✅ No hay memory leaks
- ✅ CPU usage razonable

---

## 📊 Métricas de Calidad Esperadas

Al finalizar v1.7.0, debes tener:

### **Code Quality:**
```
Global Score: >=85/100

Dimensiones individuales (todas >=70):
- Correctness: >=90
- Completeness: >=85
- Robustness: >=85
- Readability: >=80
- Maintainability: >=80
- Complexity: >=75
- Duplication: >=85
- Test Coverage: >=80
- Test Quality: >=85
- Security: 100
- Documentation: >=80
- Style: >=85
```

### **Test Coverage:**
```
Statements   : >80%
Branches     : >75%
Functions    : >80%
Lines        : >80%
```

### **Performance:**
```
Overhead: <50ms
Memory: <10MB additional
CPU: <5% adicional
```

---

## 📁 Estructura de Archivos Esperada

Al completar v1.7.0, deberías tener:

```
corbat-coco/
├── src/cli/repl/
│   ├── input/
│   │   ├── concurrent-capture-v2.ts       # Captura de input
│   │   ├── concurrent-capture-v2.test.ts
│   │   ├── message-queue.ts               # Queue de mensajes
│   │   ├── message-queue.test.ts
│   │   └── types.ts                       # Interfaces
│   ├── interruptions/
│   │   ├── classifier.ts                  # Clasificador de tipos
│   │   ├── classifier.test.ts
│   │   ├── processor.ts                   # Procesador de interrupciones
│   │   ├── processor.test.ts
│   │   └── types.ts                       # Tipos de interrupción
│   └── feedback/
│       ├── feedback-system.ts             # Sistema de feedback visual
│       ├── feedback-system.test.ts
│       └── types.ts
├── docs/architecture/adrs/
│   ├── 007-concurrent-input-architecture.md
│   └── 008-feedback-mechanism.md
├── spike/
│   ├── concurrent-input/
│   │   ├── 01-ink-prototype.ts
│   │   ├── 02-blessed-prototype.ts
│   │   ├── 03-terminal-kit-prototype.ts
│   │   ├── 04-custom-raw-mode.ts
│   │   ├── RESULTS.md
│   │   └── EVALUATION.md
│   └── feedback/
│       ├── 01-file-logging.ts
│       ├── 02-stderr-logging.ts
│       ├── 03-notification.ts
│       ├── 04-beep.ts
│       ├── 05-status-bar.ts
│       └── EVALUATION.md
├── test/e2e/
│   ├── concurrent-input-abort.test.ts
│   ├── concurrent-input-modify.test.ts
│   └── concurrent-input-multiple.test.ts
└── PLAN_V1.7.0_CONCURRENT_INPUT.md        # Este archivo
```

---

## 🔄 Workflow Completo (Resumen para Agente Coordinador)

Si eres un **agente coordinador** que ejecuta este plan:

### **Setup Inicial:**
```bash
git checkout main
git pull origin main
git checkout -b feat/concurrent-input-v1.7.0
```

### **Por Cada Fase (1-4):**

```python
for phase in [1, 2, 3, 4]:
    print(f"=== STARTING PHASE {phase} ===")

    # 1. Planning
    plan = call_plan_agent(phase_description)
    save_markdown(f"PLAN_PHASE_{phase}.md", plan)

    # 2. Architecture (si aplica)
    if phase_needs_architecture(phase):
        arch = call_arch_agent(plan)
        save_markdown(f"ARCH_PHASE_{phase}.md", arch)
        input_for_dev = arch
    else:
        input_for_dev = plan

    # 3. Development Loop
    iteration = 0
    scores = []

    while iteration < 10:
        iteration++

        # DEV: Implement
        code = call_dev_agent(input_for_dev)
        save_code(code)

        # REVIEW: Analyze
        review = call_review_agent(code)
        save_markdown(f"REVIEW_PHASE_{phase}_ITER_{iteration}.md", review)
        scores.append(review.global_score)

        # Check convergence
        if review.global_score >= 85 and iteration >= 2:
            delta = abs(scores[-1] - scores[-2])
            if delta < 2:
                print(f"✅ PHASE {phase} CONVERGED at score {review.global_score}")
                break

        # IMPROVE: Plan fixes
        improvements = call_improve_agent(review)
        save_markdown(f"IMPROVE_PHASE_{phase}_ITER_{iteration}.md", improvements)
        input_for_dev = improvements

    # Commit phase
    git_commit(f"feat(phase-{phase}): [DESCRIPTION]")

    print(f"=== PHASE {phase} COMPLETE ===\n")
```

### **Después de las 4 Fases:**

```bash
# Build y test
pnpm build
pnpm test

# Manual testing
pnpm dev
# Ejecutar Test 1-6 manualmente

# Update CHANGELOG
# Editar CHANGELOG.md con cambios de v1.7.0

# Bump version
# Editar package.json: "version": "1.7.0"

# Commit release
git add -A
git commit -m "chore(release): bump version to 1.7.0"

# Merge to main
git checkout main
git merge feat/concurrent-input-v1.7.0

# Tag
git tag v1.7.0
git push origin main
git push origin v1.7.0

# Publish
npm publish
```

---

## 📝 Notas Importantes para Agentes

### **Para TODOS los Agentes:**

1. **Lee CLAUDE.md** antes de empezar (contiene coding standards)
2. **NO uses `any` en TypeScript** - usa `unknown` y type guards
3. **Imports deben tener extensión `.js`** (ESM requirement)
4. **Tests son OBLIGATORIOS** - coverage >80%
5. **JSDoc en funciones públicas** - documenta parámetros y retornos
6. **Manejo de errores robusto** - usa `try/catch` y `ToolError`

### **Para PLAN AGENT:**
- Sé específico, no genérico
- Tareas deben ser implementables (no "mejorar X")
- Define criterios de éxito medibles

### **Para ARCH AGENT:**
- Interfaces primero, implementación después
- Diagramas en formato mermaid
- ADR con formato estándar
- Trade-offs explícitos

### **Para DEV AGENT:**
- Lee arquitectura completa antes de codear
- Implementa tests JUNTO con código (no después)
- Edge cases son críticos
- NO uses console.log (interfiere con spinner)

### **Para REVIEW AGENT:**
- Sé específico: "línea 42: falta null check"
- NO generalidades: "mejorar la calidad"
- Evidencia concreta siempre
- Score justificado por dimensión

### **Para IMPROVE AGENT:**
- Prioriza críticos (score <70) primero
- Snippets de código concretos
- Estima impacto en score
- Plan implementable por DEV AGENT

---

## 🎯 Checklist Final (Para Validación de Release)

Antes de hacer release de v1.7.0, verificar:

### **Funcionalidad:**
- [ ] Test 1 (Captura Básica) pasa
- [ ] Test 2 (Múltiples Interrupciones) pasa
- [ ] Test 3 (Abort) pasa
- [ ] Test 4 (COCO Mode) pasa
- [ ] Test 5 (Cross-Platform) pasa en macOS y Linux
- [ ] Test 6 (Performance) <50ms overhead

### **Calidad:**
- [ ] Global score >=85 en todas las fases
- [ ] Test coverage >80%
- [ ] No hay spinners duplicados
- [ ] No hay corrupción de output
- [ ] TypeScript strict mode OK
- [ ] Build pasa sin warnings

### **Documentación:**
- [ ] ADR-007 creado
- [ ] ADR-008 creado
- [ ] CHANGELOG.md actualizado
- [ ] README.md actualizado (si aplica)
- [ ] User guide con ejemplos de concurrent input

### **Git:**
- [ ] Commits con mensajes descriptivos
- [ ] Sin archivos temporales comiteados
- [ ] Branch mergeada a main
- [ ] Tag v1.7.0 creado

### **NPM:**
- [ ] package.json version bumped a 1.7.0
- [ ] Build artifacts en dist/
- [ ] npm publish completado
- [ ] Versión visible en npmjs.com

---

## 🚀 ¡A Ejecutar!

Este plan está listo para ser ejecutado por agentes siguiendo la metodología multi-agente.

**Agente Coordinador:** Sigue el workflow paso a paso, invocando a cada agente especializado según corresponda.

**Agentes Especializados:** Cuando te invoquen, lee tu sección específica y ejecuta según las instrucciones.

**Resultado Esperado:** v1.7.0 con Concurrent Input funcionando perfectamente, code quality >=85, y usuarios felices.

---

**Última actualización:** 2026-02-17
**Autor:** Plan generado para ejecución multi-agente
**Versión del plan:** 1.0
