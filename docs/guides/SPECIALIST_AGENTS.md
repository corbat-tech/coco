# Especialistas y reparto de trabajo

Coco mantiene una conversación principal responsable del resultado. Los especialistas sirven para encargos acotados; terminar una ejecución no acredita por sí solo los requisitos del trabajo.

## Uso en el chat

```text
/agents list
/agents run review Revisa el diff actual y señala regresiones concretas
/agents status
/agents explain
/agents cancel all
```

`run` inicia el trabajo en ese turno; no se limita a añadir instrucciones para una conversación posterior. También puedes escribir `@review revisa este diff` o pedir un especialista de seguridad en lenguaje natural. Una petición general como «usa agentes» queda en el agente principal para elaborar un reparto validable, en lugar de enviar todo a un investigador genérico.

```text
/agents mode manual
/agents mode auto
/agents mode off
```

- `manual`, valor inicial: delegación cuando la pide el usuario.
- `auto`, optativo: el agente principal puede proponer encargos estructurados; el host valida aceptación, dependencias, recursos y límites antes de despachar. Una llamada de creación sin un plan validado se rechaza si el usuario no pidió delegación explícitamente.
- `off`: no se crean workers y se solicita cancelar los activos. Sus efectos ya completados permanecen.

«Sin agentes», «hazlo tú solo» y «don't use agents» se aplican al turno actual. El comando `mode` cambia la preferencia persistida de la sesión. Las restricciones del host y los modos de lectura siguen prevaleciendo. Pedir secuencialidad se conserva aunque hubiera partes independientes.

No hay un clasificador remoto adicional obligatorio. La decisión parte del turno principal y de una política local conservadora. `auto` sigue siendo experimental: su ventaja de calidad, tiempo y consumo requiere la evaluación con modelos reales descrita en el plan; los tests deterministas no la demuestran.

## Perfiles distribuidos

Se conservan doce IDs: `explore`, `plan`, `architect`, `debug`, `refactor`, `test`, `review`, `security`, `tdd`, `e2e`, `docs` y `database`. Se agrupan en investigación, planificación, implementación, verificación y revisión, con variantes optativas. No se ejecutan todos para cada solicitud.

`researcher → explore`, `coder → debug`, `editor → refactor`, `tester → test`, `reviewer → review`, `optimizer → refactor`, `planner → plan`. El comando antiguo resolvía `coder` de forma distinta; ahora utiliza el mismo alias que el runtime. Un perfil desconocido se informa y no habilita delegación indirecta.

Las instrucciones del catálogo no imponen TypeScript, Vitest ni convenciones internas de Coco a los proyectos del usuario. Los perfiles vienen en el paquete compilado, sin depender de `.claude/agents/` del repositorio de desarrollo. Modelo y esfuerzo se heredan de la sesión; no hay cambio silencioso de proveedor por especialidad.

## Encargos paralelos y secuenciales

La herramienta existente `delegateTask` acepta opcionalmente `assignments` con:

```json
{
  "taskId": "investigation",
  "task": "Investigar dos hipótesis independientes",
  "assignments": [
    {
      "id": "network",
      "profile": "explore",
      "objective": "Localizar la causa de los reintentos de red",
      "acceptance": ["Identificar rutas y condiciones que disparan los reintentos"],
      "resources": { "reads": ["src/network.ts"], "writes": [] }
    },
    {
      "id": "cache",
      "profile": "explore",
      "objective": "Localizar invalidaciones incorrectas de caché",
      "acceptance": ["Identificar una hipótesis verificable con referencias"],
      "resources": { "reads": ["src/cache.ts"], "writes": [] }
    }
  ]
}
```

Los nombres de archivos son ejemplos y deben corresponder al proyecto real. `dependsOn: ["network"]` establece una dependencia. Un prerequisito fallido bloquea sus descendientes; el coordinador especializado puede continuar las ramas independientes y aun así devolver fracaso global. El grafo genérico conserva `fail-fast` por defecto.

Primera versión: dos workers concurrentes y hasta cuatro por turno por defecto; límites configurables y validados. Se permite solapar lecturas independientes. Los nodos con capacidad de mutación se serializan, aunque declaren archivos disjuntos. La creación directa de workers también rechaza conflictos de propiedad.

En planes estructurados, las escrituras se limitan a archivos explícitos mediante `write_file` y `edit_file`. Se normalizan rutas contra el proyecto del host y se comprueban symlinks. Sobrescribir un archivo existente exige una lectura observada vigente; `write_file.expectedContentHash` vuelve a comprobar el contenido después de la aprobación, justo antes de escribir. `null` exige que el archivo siga sin existir. `edit_file` conserva su comprobación de texto original. No son operaciones CAS atómicas entre procesos: sigue existiendo una ventana residual de carrera en el filesystem.

Shell, migraciones, pruebas con efectos no acotables y otras herramientas mutadoras quedan bloqueadas dentro del adaptador de planes: el worker debe devolver una propuesta o un bloqueo. El agente principal puede ejecutar las verificaciones pertinentes mediante su frontera normal de permisos. Las listas de lectura son contexto del encargo; no se presenta confinamiento de lectura por archivo ni sandbox del sistema operativo.

## Autoridad, presupuesto y recuperación

Las operaciones de cada worker vuelven a pasar por el runtime. Aprobar la creación del especialista no aprueba todas sus llamadas: la interfaz puede pedir consentimiento para la operación hija exacta. Omitir las confirmaciones no concede ese consentimiento. El permiso efectivo está limitado por el modo y la autoridad del padre.

Padre, workers y resúmenes de compactación comparten admisión de solicitudes en los turnos con delegación. Los turnos no se multiplican por número de agentes. Uso desconocido impide admitir nuevas llamadas. Los límites de tokens del contador son estimaciones/admisión local, no garantía de factura ni de límite duro del proveedor.

Los workers no pueden subdelegar. Las respuestas truncadas, combinaciones incoherentes de stop reason y agotamiento de turnos no producen éxito. Cancelación y timeout conservan su estado canónico; el historial muestra una ejecución interrumpida cuando se reabre una sesión que tenía un worker en marcha.

La CLI enlaza checkpoints antes de efectos y después de observaciones al ledger existente. Si falla la persistencia previa, no se ejecuta el efecto. Un resultado incierto requiere inspección y reconciliación del host; reabrir la sesión no vuelve a ejecutar automáticamente el plan. No se promete reanudar un grafo arbitrario ni revertir efectos externos.

Los efectos nuevos quedan bloqueados mientras exista un resultado incierto de una ejecución anterior. Las lecturas siguen disponibles para inspeccionar. `/work` muestra los IDs; después de comprobar el resultado puedes registrar `/work resolve <evidenceId> applied|not-applied <motivo de inspección>`. Esta acción no ejecuta la operación ni fabrica un test aprobado. Los embedders disponen de `reconcileWorkEvidence`; las ejecuciones del runner durable conservan además su mecanismo de resolución de transcript.

Los embedders deben proporcionar el ejecutor real, autoridad y persistencia. `AgentRunner` falla si no tiene ejecutor; `allowSimulated` es solo para simulación explícita. Las callbacks `runAgent`, `approveDelegatedTool` y `checkpoint` son capacidades del host y nunca argumentos emitidos por el modelo. La ruta legacy global se conserva fuera de la nueva integración de sesión.

## Evidencia y evaluación

Resultados, artefactos y recibos conservan procedencia. Un plan devuelve aceptación `unverified`: el agente principal debe comprobar el resultado integrado contra los requisitos y las comprobaciones observadas vigentes. El texto «tests pasados» de un worker no crea un recibo válido.

El corpus de 36 solicitudes sirve para routing; no es un benchmark de programación. El harness de evaluación exige fixtures de proyecto y verificadores externos. La campaña con modelos reales está pendiente de presupuesto y autorización; no se ha utilizado para anunciar mejoras de velocidad o paridad competitiva.

Consulta el [plan de implementación](../evolution/SPECIALIST_AGENTS_IMPLEMENTATION_PLAN_2026-10-28.md), el [registro de ejecución](../evolution/SPECIALIST_AGENTS_WORKLOG.md) y el contrato de [continuidad y recuperación](CONVERSATION_CONTINUITY.md).
