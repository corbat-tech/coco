# Revisión de Coco y mejora de flujos agénticos

Consulta de fuentes y ejecución: **27 de octubre de 2026**. Punto de partida:
`11e5603890027bf8e9beb31728201b8ec99e3889` (2.42.0). Esta revisión contrasta
documentación oficial con código de Coco y una tarea real acotada. Los otros
productos no se ejecutaron: sus capacidades documentadas no constituyen un
benchmark comparativo de calidad, velocidad o autonomía.

## Referencias externas y decisiones

| Referente y evidencia primaria | Capacidad útil documentada u observada | Aplicación a Coco |
| --- | --- | --- |
| [OpenCode: agentes](https://opencode.ai/docs/agents/) | Agentes principales Build/Plan y subagentes con instrucciones, modelo y permisos configurables. | Coco ya tiene modos y roles; mejorar su ejecución efectiva aporta más que añadir otra lista de roles. |
| [OpenCode V2: compactación](https://dev.opencode.ai/v2/docs/compaction/) y [código abierto del compactador](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/compaction.ts) | Resúmenes, contexto reciente conservado y tratamiento de overflow. El código maneja presupuestos, fallos y compactación nativa o por resumen. | Comprobar contexto entre iteraciones de un mismo turno. No mezclar opciones V1 con V2 ni presentar la rama `dev` como una versión estable auditada. |
| [Claude Code: subagentes](https://code.claude.com/docs/en/sub-agents) y [hooks](https://code.claude.com/docs/en/hooks) | Contextos especializados, herramientas/permisos por agente y puntos de control del ciclo de ejecución. | Mantener delegaciones pequeñas, contratos de éxito explícitos y controles en la ejecución. Coco ya dispone de hooks; esta entrega no incorpora todo el catálogo de eventos de Claude. |
| [Copilot CLI: permisos](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools) | Separa herramientas ofrecidas al modelo de permisos efectivos; las prohibiciones prevalecen sobre aprobaciones. | Conservar la frontera de permisos del runtime. Un evaluador sin interfaz debe configurar autoridad explícita. |
| [Gemini CLI: núcleo](https://geminicli.com/docs/core/) y [checkpoints](https://geminicli.com/docs/cli/checkpointing/) | Compresión antes de enviar contexto; checkpoints opcionales que guardan archivos, conversación y llamada pendiente. | Compactación preventiva y restauración exacta del historial al cancelar. Los checkpoints limitados de Coco no equivalen a snapshots completos del entorno. |
| [Kimi Code CLI: agentes](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents) | Agentes personalizados, listas de herramientas y configuración de subagentes. | Revisar permisos y resultado de cada delegación; preservar dependencias y prioridades. Se compara el agente CLI, no solamente el modelo Kimi. |
| [DeepSeek: llamadas a herramientas](https://api-docs.deepseek.com/guides/tool_calls/) y [contrato Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) | La API devuelve llamadas para que el cliente las ejecute y distingue salida final de truncamiento por límite. | El ejecutor de Coco debe rechazar resultados incompletos antes de ejecutar herramientas. Estas fuentes describen una API/modelo, no prueban la existencia de un agente de desarrollo equivalente. |
| [OpenAI: subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents) y [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | Delegación de trabajo especializado y selección explícita del esfuerzo de razonamiento. | Coordinar componentes independientes y verificar el parámetro en el transporte, además de su presencia en la interfaz. La disponibilidad concreta de Luna se verificó con una petición real. |
| [Aider: lint y tests](https://aider.chat/docs/usage/lint-test.html) | Los fallos de comandos alimentan el siguiente intento; la ejecución automática de tests es configurable. | Mantener comprobaciones focalizadas durante desarrollo y verificar externamente el resultado final. No ejecutar toda la suite después de cada edición. |

Las decisiones de aplicación son inferencias de ingeniería. No se ha copiado
código de esos proyectos ni añadido dependencias para reproducir sus plataformas.

## Estado de Coco contrastado con código

| Área | Evidencia local | Estado y límite práctico |
| --- | --- | --- |
| Flujo interactivo | [`agent-loop.ts`](../../src/cli/repl/agent-loop.ts), [`agent-modes.ts`](../../src/runtime/agent-modes.ts), [`commands/plan.ts`](../../src/cli/repl/commands/plan.ts) | Herramientas, modos, planificación y steering implementados. `requiresVerification` es metadato; no demuestra por sí solo que se ejecutaron tests. |
| Flujos COCO históricos | [`commands/build.ts`](../../src/cli/commands/build.ts), [`commands/resume.ts`](../../src/cli/commands/resume.ts) | Los comandos históricos son stubs que fallan explícitamente. Diagramas de fases y tutoriales simulados no acreditan ejecución autónoma de backlogs. |
| Contexto y memoria | [`session.ts`](../../src/cli/repl/session.ts), [`compactor.ts`](../../src/cli/repl/context/compactor.ts), [`memory/`](../../src/cli/repl/memory/) | Sistema compuesto, instrucciones/memoria y resumen con cola reciente. Antes se compactaba después del bucle; ahora también entre iteraciones de sesiones gestionadas. |
| Herramientas y autoridad | [`registry.ts`](../../src/tools/registry.ts), [`permission-policy.ts`](../../src/runtime/permission-policy.ts), [`runtime-tool-dispatch.ts`](../../src/cli/repl/runtime-tool-dispatch.ts), [`bash-patterns.ts`](../../src/cli/repl/bash-patterns.ts) | Validación, permisos y aprobación ligada a la llamada. Omitir la interfaz no autoriza escrituras. La política de aplicación no constituye aislamiento del sistema operativo. |
| Extensiones | [`src/mcp/`](../../src/mcp/), [`src/skills/`](../../src/skills/), [`hooks/`](../../src/cli/repl/hooks/) | Hay integración MCP, descubrimiento de skills y hooks. La herramienta remota sigue sujeta a la frontera de autoridad del host; una descripción no concede permisos. |
| Delegación | [`executor.ts`](../../src/agents/executor.ts), [`coordinator.ts`](../../src/agents/coordinator.ts), [`agent-coordinator.ts`](../../src/tools/agent-coordinator.ts), [`multi-agent.ts`](../../src/runtime/multi-agent.ts) | Conviven superficies históricas y contratos del runtime. Se han corregido éxito truncado, dependencias y prioridad del plan público; no se ha unificado toda la orquestación. |
| Recuperación y persistencia | [`checkpoints/capture.ts`](../../src/cli/repl/checkpoints/capture.ts), [`agent-runtime.ts`](../../src/runtime/agent-runtime.ts), [`tool-calling-turn-runner.ts`](../../src/runtime/tool-calling-turn-runner.ts) | Checkpoints de archivos elegibles y eventos de herramientas. Restaurar conversación tras cancelación no deshace efectos completados. El runner embebido mantiene su contrato de persistencia previo. |
| Observabilidad y evaluación | [`turn-quality.ts`](../../src/cli/repl/turn-quality.ts), [`evals.ts`](../../src/cli/repl/evals.ts), [`tracing.ts`](../../src/runtime/tracing.ts) | Telemetría, replay y trazas implementados. La nota heurística puede ser alta aunque fallen criterios de aceptación: se observó 91 en una ejecución inicial incompleta. |

## Mejoras entregadas y criterios verificados

La implementación se dividió entre dos conversaciones del proyecto (contexto y
herramientas/delegación) y una coordinadora (proveedor, evaluación, integración y
documentación). Se asignaron archivos distintos, se esperó a capturar la referencia
inicial y se revisaron los cambios conjuntamente antes de publicar.

| Problema reproducido | Comportamiento entregado | Verificación y riesgo controlado |
| --- | --- | --- |
| Una sola lectura fallida volvía a contarse desde el historial completo hasta activar el corte de tres errores. | Los contadores consumen solo el lote actual. Los éxitos antiguos tampoco amplían el presupuesto de una iteración fallida. | [`agent-loop-progress.test.ts`](../../src/cli/repl/agent-loop-progress.test.ts): dos regresiones fallaban antes y pasan después; siguen deteniéndose tres fallos realmente consecutivos. |
| El contexto podía crecer durante un turno antes de alcanzar la compactación posterior. | Comprobación preventiva entre lotes completos cuando la sesión tiene gestor de contexto. Un resumen fallido o sin reducción no se repite cada iteración del mismo turno. | [`agent-loop-compaction.test.ts`](../../src/cli/repl/agent-loop-compaction.test.ts): umbral, no-op, resumen fallido/sin reducción y pares íntegros. No se añade recuperación automática de overflow del proveedor. |
| Restaurar solo la longitud del historial era inválido después de que la compactación sustituyese el array. | Cancelar restaura la copia de mensajes previa y actualiza su recuento. | Cancelación durante y después del resumen conserva steering y pares existentes, sin huecos. Los efectos externos completados permanecen. |
| El recuento tras compactar omitía el sistema compuesto. | Se cuentan mensajes y prompt efectivo tras instalar el historial reducido. | [`session-compaction.test.ts`](../../src/cli/repl/session-compaction.test.ts), incluida memoria de proyecto. El contador sigue siendo estimado. |
| El adaptador de suscripción ignoraba el esfuerzo de razonamiento. | Las cuatro vías chat/stream, con/sin herramientas, envían `reasoning.effort` conforme al catálogo; se rechaza `off` cuando el modelo exige razonamiento. | [`codex.test.ts`](../../src/providers/codex.test.ts): parámetros serializados, nivel por defecto, niveles explícitos y compatibilidad de modelo desconocido. |
| El ejecutor delegado declaraba éxito con `max_tokens`. | Resultado incompleto con salida y consumo preservados; no ejecuta llamadas pendientes de esa respuesta. | [`executor.test.ts`](../../src/agents/executor.test.ts), con/sin llamadas truncadas y pruebas de cancelación existentes. |
| Las dependencias continuaban después de un resultado `success: false`. | Bloqueo transitivo explícito con `blockedBy`, cero llamadas/tokens para tareas bloqueadas; ramas independientes continúan. | [`coordinator.test.ts`](../../src/agents/coordinator.test.ts): cadena, diamante y rama independiente. Cambia deliberadamente el comportamiento de planes que antes ejecutaban requisitos fallidos. |
| `create_agent_plan` perdía `priority` antes de ordenar. Al conservarla, una ordenación global podía adelantar un dependiente a su requisito. | Aplica prioridad entre tareas listas, respetando dependencias y empates estables. En `priority-based`, las dependencias ausentes se reportan y bloquean sus descendientes; los ciclos producen error explícito. | [`agent-coordinator.test.ts`](../../src/tools/agent-coordinator.test.ts): pruebas públicas de prioridad, requisito de prioridad baja, bloqueo transitivo y ciclos. |
| El compactador forzaba razonamiento desactivado, incompatible con modelos que lo requieren. | El resumen hereda el valor válido por defecto del adaptador, sin forzar `off`. | Regresión de compactación con el adaptador real y transporte simulado para Sol, Astra y Luna. Puede aumentar el coste del resumen frente a modelos que antes aceptaban desactivar razonamiento. |

## Evaluación real con GPT-6 Luna y esfuerzo medio

Se ejecutó `executeAgentTurn` con el adaptador real de suscripción, no un replay
ni otro modelo. La referencia usó un `git archive` del commit inicial. Ambas
versiones recibieron el mismo fixture, prompt, herramientas, autorización y
presupuesto: **24 iteraciones configuradas, 240 s por tarea y 60 s por petición**.
El mecanismo existente permite extensiones acotadas del presupuesto; no se
alcanzaron en la ejecución final. Node **26.4.0**, pnpm **10.0.0**, sin instalar
dependencias ni ejecutar operaciones Git/red desde el agente evaluado.

El evaluador fijó `reasoning.effort: medium` en el transporte de ambas versiones
para compensar el fallo inicial del adaptador y evitar comparar esfuerzos
distintos. Registró además el valor nativo: ausente antes, `medium` después. La
prueba de parámetros serializados verifica la corrección del producto sin esa
compensación. El modelo respondió primero a una petición mínima de disponibilidad.

### Escenario y aceptación establecidos antes de ejecutar

Repositorio ESM mínimo con `src/parse.mjs`, `src/aggregate.mjs`, `src/cli.mjs`,
README, una nota que debe conservarse literalmente y seis pruebas de aceptación.
El parser inicial separaba filas sin validación ni encabezado; el agregador
descartaba ceros y usaba propiedades heredadas como acumuladores.

La tarea exige localizar un parser cuya ruta antigua `src/parser.mjs` no existe,
leer código/documentación/tests, planificar brevemente, corregir parser y
agregador, añadir regresiones, actualizar README y verificar con `node --test`.
Tras la primera edición correcta se inyecta steering sobre nombres de equipos
`__proto__`, `constructor` y `toString`. Se conservan las APIs públicas
`parseRows(text)` y `summarize(rows)` y no se modifican las pruebas de aceptación.

Los seis criterios externos comprueban CRLF/encabezado/blancos, entrada vacía,
equipos con valor cero, rechazo de filas inválidas/no finitas, claves especiales
como propiedades propias de un objeto ordinario y ausencia de mutación de entrada.
El verificador vuelve a ejecutar las pruebas al terminar. Una comprobación final
adicional de CLI verifica JSON con acumulación, negativos y `__proto__`.

Herramientas expuestas: `read_file`, `write_file`, `edit_file`, `glob`, `list_dir`,
`grep` y una herramienta de ejecución limitada por el host a `node --test`, sin
shell general. Escritura/edición y la invocación exacta de tests tienen autoridad
explícita de sesión. Los archivos y directorios pertenecen al fixture temporal;
esto reduce efectos accidentales pero no constituye una VM aislada.

| Medida observada | Inicial válida 1 | Inicial válida 2 | Mejora: primera evaluación | Final integrada |
| --- | ---: | ---: | ---: | ---: |
| Resultado externo | Incompleto | Incompleto | Completado | Completado |
| Duración | 64,56 s | 23,94 s | 31,56 s | 23,53 s |
| Peticiones al modelo | 5 | 5 | 18 | 13 |
| Herramientas ejecutadas | 4 | 4 | 17 | 15 |
| Herramientas fallidas | 1 | 1 | 3 | 2 |
| Steering tras edición | No alcanzado | No alcanzado | Incorporado | Incorporado |
| Suite al terminar | Falla | Falla | 9/9 pasan | 9/9 pasan |
| Nota y aceptación conservadas | Sí | Sí | Sí | Sí |
| Tokens de entrada estimados por REPL | 2.412 | 2.412 | 50.970 | 33.102 |
| Tokens de salida estimados por REPL | 96 | 96 | 1.400 | 1.394 |

La primera referencia devolvió contenido vacío al fallar la explicación final;
la segunda reconoció que no había completado el trabajo. Ambas quedaron cortadas
después de una lectura fallida seguida de progreso. Una comprobación intermedia
tras las primeras mejoras aún reprodujo el corte (5 peticiones, 4 herramientas,
6,46 s). Esto condujo a corregir el recuento de errores históricos.

Las dos evaluaciones posteriores a corregir el corte leyeron archivos, editaron
código, añadieron pruebas y documentación, recibieron steering y verificaron el
resultado. Cada una terminó con las seis pruebas externas y tres añadidas
aprobadas. La primera tuvo tres fallos: tests sobre código defectuoso, ruta
antigua y una aserción incorrecta en un test nuevo; corrigió esta última antes de
terminar. La final tuvo solo los dos primeros fallos esperados. En ambas, el
verificador externo confirmó además la salida de CLI.

La primera evaluación mejorada corresponde al cambio de control de progreso
`0179759`; la confirmación final se repitió sobre `bc7e140`, que incluye también
los ajustes de compactación con razonamiento obligatorio y prioridad topológica
detectados en revisión cruzada. No se cambiaron prompt, fixture ni presupuestos.

Hubo un intento preliminar inválido por configuración del evaluador: omitía la
interfaz pero no concedía autoridad de escritura. Se corrigió el harness, sin
relajar los permisos de Coco, y se descartó ese intento de la comparación. La
única intervención posterior al inicio de cada ejecución válida fue el steering
programado; no hubo edición manual para hacer pasar el fixture.

**Interpretación:** la reparación del corte está respaldada por una regresión
determinista y por este resultado real. Completar la tarea usa más herramientas
y tokens que detenerse pronto. No se acredita una mejora general de velocidad,
coste o tasa de éxito con estas pocas ejecuciones. El escenario no estresa la
ventana completa de un millón de tokens ni evalúa horas de ejecución, proveedores
distintos o coordinación real entre varios modelos. La compactación y delegación
se verifican aquí mediante pruebas deterministas separadas.

Los scripts, fixtures, checkpoints de evaluación, logs y plan de trabajo se
eliminan al cerrar la entrega por petición del usuario. Se conservan esta receta,
los commits y las regresiones mantenidas; no se presenta el evaluador eliminado
como un benchmark disponible para ejecutar directamente.

## Verificación integrada

- `pnpm test:coverage`: **408 archivos**, **8.463 pruebas aprobadas**, **15 omitidas**.
- Cobertura: líneas **81,10 %**, sentencias **80,30 %**, funciones **82,16 %**,
  ramas **71,27 %**; cumple los umbrales configurados. Existen exclusiones de
  cobertura en `vitest.config.ts`, incluidas superficies históricas de coordinación.
- `pnpm test:repl`: **28 pruebas aprobadas** en la suite separada.
- `pnpm typecheck`, `pnpm lint`, `pnpm format` y `pnpm build`: correctos.
- Typecheck de las cinco aplicaciones del workspace: correcto sobre el build final.
- CLI compilada: `--version` y `--help` correctos. No se cambia la versión npm
  ni se publica un paquete como parte de esta entrega.
- El lint conserva una advertencia previa en `src/tools/utils/owned-shell.ts`
  sobre su objeto thenable; no hay errores de lint ni cambios en ese archivo.
- Ejecución local sobre Node 26.4.0; no se afirma haber ejecutado la matriz CI
  de Node 22 ni una auditoría exhaustiva de seguridad de todos los proveedores.
- La rama parte del commit inicial indicado. El `main` remoto consultado durante
  el cierre (`f8742a5`) contiene ocho commits posteriores de dependencias/CI;
  esta entrega no incorpora esas actualizaciones ni afirma haberlas validado.

## Oportunidades posteriores, por orden de valor

| Orden | Trabajo y pasos concretos | Aceptación necesaria antes de ampliar autonomía |
| --- | --- | --- |
| 1 | Unificar el transcript de herramientas del runner embebido: definir persistencia de llamadas/resultados, registrar efectos completados antes de otro request y probar reapertura después de fallo. | No repetir una escritura ya ejecutada al reanudar; pares válidos después de cancelación y almacenamiento fallido. El runner actual usa historial local durante el turno y no persiste todo ese transcript. |
| 2 | Recuperación de overflow: clasificar el rechazo, compactar una vez en frontera segura y reintentar solo si no se ejecutaron efectos nuevos. | Preservar instrucciones y resultados; fallar explícitamente si el sistema/herramientas ya ocupan la ventana. No añadir reintentos ilimitados. |
| 3 | Unificar ejecutor histórico, grafo runtime y swarm: migrar una superficie cada vez a los contratos compartidos de resultados, dependencias, presupuesto y autoridad. | Mismas semánticas de truncamiento, bloqueo y cancelación; contratos públicos compatibles. |
| 4 | Acreditar finalización por evidencias: separar tareas pendientes, verificaciones ejecutadas y bloqueos del texto libre y de la nota heurística. | Un flujo fallido no figura como completado por tener puntuación alta; registrar comandos reales y aceptación externa. |
| 5 | Contexto de herramientas medido: incluir esquemas serializados en el presupuesto cuando el proveedor permita medirlos; explorar descubrimiento diferido para registros grandes. | Pruebas con catálogos MCP grandes sin ocultar herramientas requeridas ni alterar permisos; comparar tokens medidos frente a estimados. |
| 6 | Evaluación más amplia: tareas reservadas, repeticiones con semilla cuando esté disponible, presupuestos idénticos y una matriz pequeña de proveedores. | Publicar fallos y variabilidad; demostrar beneficio antes de añadir compactación en segundo plano, conmutación de modelo o infraestructura remota. |

Estas oportunidades quedan explícitamente fuera de la implementación entregada;
no se atribuyen al comportamiento actual. Se priorizó reparar fallos demostrados
sin introducir otro framework, permisos más amplios ni infraestructura adicional.
