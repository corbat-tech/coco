# Auditoría independiente de excelencia

Fecha: 27 de octubre de 2026. Base inspeccionada: `78fdac6`.
Esta auditoría revisa diseño y código; los resultados de ejecución corresponden
al evaluador independiente.

**Estado final de revisión: favorable, sin bloqueadores identificados; checks
globales finales confirmados por la coordinadora.** Los
P1 descritos en las revisiones intermedias están corregidos. Las secciones
siguientes conservan la secuencia de hallazgos y su resolución; el dictamen y
las puntuaciones vigentes figuran en la última sección. Resultado externo final:
Coco 94/95 criterios comunes, media de grupos 98,89, 13/13 reservados y 17/17
contratos; OpenCode 95/95 y media 100. No acredita paridad general de productos.

## Escala y evidencia

Rúbrica original facilitada por la coordinadora antes de la evaluación final:
0: ausencia comprobada; 1: rudimentario; 2: parcial; 3: funcional;
4: robusto con verificación amplia; 5: sobresaliente, repetido y comparado.
La puntuación describe el alcance acreditado,
no una probabilidad de éxito. ND significa evidencia insuficiente, nunca cero.

| Dimensión original | Peso | Base /5 | Evidencia y límite | Confianza |
| --- | ---: | ---: | --- | --- |
| Finalización y verificación | 20 | 2 | Prueba real anterior completada y regresiones de truncamiento; falta aceptación conectada al plan y calidad sigue siendo self-report. | Alta |
| Continuidad, contexto y recuperación | 15 | 2 | Compactación entre lotes y resume; transcript runtime se pierde tras efectos y cancelación REPL borra hechos del turno. | Alta |
| Edición y comprensión del repositorio | 15 | 3 | Lectura/búsqueda/edición y tarea multiarchivo real anterior; no hay evaluación amplia de repositorios ni lenguajes. | Media |
| Herramientas | 10 | 3 | Registro, validación, MCP y ejecutor compartido; streaming runtime sigue siendo texto. | Alta |
| Planificación y adaptación | 10 | 2 | Modos, planes, steering y ProgressTracker; falta ledger persistido conectado al modelo y a verificación. | Alta |
| Delegación | 10 | 3 | Regresiones de dependencias, prioridad y truncamiento; conviven varias superficies. | Media |
| Experiencia y control | 5 | 3 | REPL, steering, cancelación y headless funcionales; headless aún sin continuidad visible de sesión. | Media |
| Permisos y aislamiento | 5 | 3 | Ejecutor común y pruebas de límites; no equivale a sandbox del sistema operativo. | Media |
| Observabilidad y reproducibilidad | 5 | 3 | Trazas, replay y receta de evaluación anterior; scripts ad hoc anteriores eliminados al cierre. | Media |
| Eficiencia | 5 | ND | Hay contadores y estimaciones, pero no una medición suficiente de eficiencia de esta base en el nuevo flujo continuado. | Baja |

Se puntúan capacidades auditadas, no rendimiento observado en los nuevos fixtures.
No se publica total por la cobertura desigual: nueve dimensiones evaluadas
(95 % del peso), eficiencia ND. No se renormaliza ni se sustituye ND por cero.

La evidencia anterior de ejecución se describe en
[la revisión de octubre](AGENT_REVIEW_2026-10-27.md). No se ha vuelto a ejecutar
ni se atribuye a escenarios nuevos. Una vulneración de autoridad, un efecto
duplicado por recuperación automática o una finalización falsa bloquea la puerta
correspondiente aunque otras dimensiones tengan buena puntuación.

## Revisión previa del diseño

- **Transcript:** persistir intención antes del efecto y resultado antes del
  siguiente; distinguir llamadas planeadas, iniciadas y terminadas. Si falla el
  guardado posterior al efecto, detener el turno y conservar resultado incierto.
  No prometer exactamente una ejecución para shell/MCP ni concurrencia entre procesos.
- **Concurrencia y estado:** guardia por sesión antes del primer `await`, liberada
  en `finally`. Los patches de transcript deben leer la sesión más reciente para
  conservar metadata del ledger, recibos y revisiones.
- **Cancelación:** mantener hechos de acciones realizadas aunque se restaure el
  prompt; una notificación en pantalla no sustituye evidencia persistida.
- **Contexto:** contar mensajes, sistema compuesto, schemas realmente ofrecidos
  y reserva de salida. Un solo reintento de la petición rechazada, sin repetir
  herramientas anteriores. Si no reduce o no cabe, terminar explícitamente.
- **Compactaciones sucesivas:** conservar la procedencia de resúmenes generados
  por el host. El compactador usa identidad de objetos en un WeakMap: clonar el
  historial puede convertir resúmenes previos en instrucciones preservadas.
  El desarrollador B ha sustituido la copia profunda por una copia del array;
  queda pendiente comprobar varios ciclos con el compactador real.
- **Ledger:** identidad de sesión inyectada por el host; sin fallback global.
  Un recibo existente acredita una ejecución, no aceptación. Separar claim de
  finalización, resultado observado y evidencia vigente tras la última mutación.
  Un comando arbitrario exitoso no prueba que el producto cumpla sus requisitos.
- **Persistencia:** snapshot coherente y lectura validada; fallo al guardar debe
  ser visible. Atomicidad de rename no demuestra fsync ni exclusión multiproceso.

## Comparación documental

Fuentes oficiales consultadas el 27 de octubre. Confianza alta en que la capacidad
está documentada; rendimiento y cumplimiento real en los fixtures nuevos: ND.
No hay ranking agregado entre productos ejecutados y productos solo documentados.

| Producto | Capacidad documentada relevante | Comparación pertinente |
| --- | --- | --- |
| [OpenCode CLI](https://opencode.ai/docs/cli/), [permisos](https://opencode.ai/docs/permissions/), [configuración](https://opencode.ai/docs/config/) | Continuación y gestión de sesiones, herramientas, permisos granulares y compactación configurable. | Contrastar sesiones accionables reabiertas y autoridad consistente entre superficies; no atribuir garantías de efectos no medidas. |
| [Claude Code](https://code.claude.com/docs/en/sub-agents) | Subagentes con herramientas, permisos y contexto configurables. | Comparar aislamiento y límites de delegación; no inferir éxito de tarea por tener roles. |
| [Gemini CLI](https://geminicli.com/docs/cli/checkpointing/) | Checkpointing del estado de archivos y conversación. | Comparar recuperación dentro del alcance de snapshot; no inferir rollback universal de efectos externos. |
| [Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools) | Control de herramientas disponibles y permisos efectivos. | Separar oferta al modelo y autorización real de ejecución. |
| [Aider](https://aider.chat/docs/usage/lint-test.html) | Ejecución configurable de lint/tests y uso de fallos en el siguiente intento. | Verificar comandos observados y aceptación del resultado final, separados de autocalificación. |

## Puertas para la entrega

1. Transcript duradero: efecto seguido de fallo, cancelación y reapertura;
   resultado conocido conservado y resultado incierto sin repetición automática.
2. Contexto: catálogos grandes, tres compactaciones sucesivas, overflow tras un
   lote ya ejecutado y segundo rechazo terminal; restricciones y pares íntegros.
3. Trabajo: steering conserva pendientes, evidencia inventada o fallida no pasa,
   mutación posterior invalida verificación y reapertura conserva estado.
4. Integración: casos externos por superficie soportada, permisos equivalentes,
   persistencia fallida visible y checks finales sobre los archivos entregados.

Los resultados por iteración se incorporarán después de revisar el diff y la
evidencia. Esta primera revisión no declara superadas esas puertas.

## Revisión de bloque B: contexto y overflow

Revisión independiente del diff de trabajo, aún sin commit de integración.
El auditor ejecutó `context-budget.test.ts`, `context-overflow.test.ts`,
`agent-loop-compaction.test.ts` y `session-compaction.test.ts`: **39/39 pasan**.
La extracción a `runtime/context-compactor.ts` es mecánicamente idéntica al
compactador anterior salvo la ruta del import de tipos. Se mantiene un WeakMap
compartido a través del reexport de compatibilidad del CLI.

Se verificaron presupuesto de schemas ofrecidos y reserva, modo de planificación
con subconjunto, contexto fijo imposible, rechazo por falta de reducción,
clasificación estrecha de overflow y tres compactaciones sucesivas sin acumular
instrucciones de resúmenes anteriores. La prueba del segundo rechazo termina sin
repetir la llamada a herramienta anterior: una herramienta y tres peticiones.
Ese fixture usa `read_file`; no acredita por sí solo recuperación de un efecto
mutante después de reiniciar el proceso.

Dictamen: sin bloqueador específico del bloque B encontrado. La aprobación es
acotada al diff y esas pruebas; la puerta conjunta de recuperación espera A/C,
persistencia y escenarios externos. La dimensión combinada continuidad/contexto/
recuperación permanece en **2/5** hasta acreditar esas integraciones. La
subcapacidad de contexto alcanza comportamiento funcional **3/5**, sin elevar
por ello la dimensión completa ni declarar paridad con otro producto.

Riesgos de integración comunicados: el journal del ledger debe identificar el
objetivo de las escrituras y sus llamadas, conservar acciones inciertas aunque
se limite el historial, y distinguir un check observado de aceptación completa.
Los recibos exclusivos de checks no sustituyen el registro de efectos de todas
las herramientas. Estos puntos no se dan por resueltos con la aprobación de B.

## Revisión inicial de C y su integración con A

El ledger revisado registra intención antes del dispatch y resultado después;
conserva entradas `running`, identifica objetivos de archivo y separa checks de
observaciones. La revisión encontró dos bloqueadores de integración comunicados
a la coordinadora, pendientes de nueva revisión:

- El REPL restaura `workLedger` mediante metadata de `createSession`, pero A
  reserva esa clave y rechaza la entrada. La restauración necesita una operación
  del host posterior a la creación y una prueba del turno siguiente a reabrir.
- `SessionStore.save` captura metadata antes de sus operaciones asíncronas,
  conversación después y ledger al final; el snapshot puede combinar estados
  distintos. Debe capturar una sola vista antes del primer `await`. Escribir
  proyecciones legacy antes del primer snapshot también deja una recuperación
  parcial si falla ese guardado inicial.

El auditor ejecutó cuatro archivos focalizados (ledger, almacenamiento, resume
seguro y compactación): **101/102 pasan**. La expectativa fallida exige que
corromper `conversation.jsonl` invalide una sesión cuyo snapshot sigue válido;
eso contradice la nueva autoridad del snapshot y necesita una prueba actualizada,
además de cubrir snapshot corrupto y fallos de escritura/rename. No se atribuye
esa expectativa antigua a un fallo del producto.

Riesgo adicional comunicado: comandos como `node --test --help` no deben generar
evidencia de check ejecutado por devolver código cero. Sigue pendiente comprobar
los cambios de esta revisión; C todavía no está aprobado.

Revisión posterior del mismo bloque: el seed del REPL usa ahora creación sin
metadata reservada y actualización validada del host; la captura del snapshot
ocurre antes del primer `await`, sus guardados se serializan por sesión y el
snapshot se confirma antes de escribir proyecciones opcionales. Esos dos P1
quedan corregidos por inspección del código. Una nueva ejecución focalizada del
auditor pasa **28/28**, incluidos almacenamiento por snapshot y escritura real
durante los escenarios de overflow/cancelación reforzados de B.

Quedan pendientes de cierre las pruebas de primer guardado fallido y mutación
durante un guardado, la consulta `exists` frente a proyecciones opcionales y la
clasificación de comandos informativos como checks. A incorpora streaming de
herramientas con salida final en bloque: se ha señalado que el evento de error
debe conservar el ID de la sesión creada para poder recuperar efectos. Se
mantiene pendiente la aprobación conjunta y la evaluación externa.

## Cierre focal de C

Nueva ejecución independiente: **111/111 pruebas pasan** en cinco archivos:
ledger, snapshots, almacenamiento de sesiones, resume seguro y compactación del
bucle. Se corrigieron los hallazgos de metadata reservada, captura mezclada,
primer guardado fallido, `exists` basado en proyección opcional y flags de
ayuda/versión/listado confundidos con checks. Los casos nuevos cubren captura
anterior a mutaciones asíncronas, cola de guardados y fallo del primer rename.

Dictamen acotado: C aprobado para ledger de claims/checks y snapshots coherentes,
sin bloqueadores focales pendientes identificados. Planificación/adaptación pasa
de **2 a 3/5**; finalización/verificación de **2 a 3/5** por incorporar evidencias
observadas vigentes. Esto no demuestra cobertura semántica de la especificación
por cualquier comando aprobado, ni justifica 4/5 sin evaluación externa amplia.
La dimensión combinada de continuidad/contexto/recuperación sigue pendiente de A
y sus escenarios externos.

Límite comunicado: en el REPL el store runtime sigue siendo memoria y el journal
alcanza disco mediante el guardado de sesión. Cancelar y guardar conserva hechos;
un cierre abrupto anterior al siguiente guardado puede perder efectos recientes.
El runtime/headless configurado con FileRuntimeSessionStore tiene otro alcance:
sus patches se confirman en disco antes/después de herramientas. No se atribuye
esa garantía al REPL ni a stores de memoria por tener la misma interfaz.

## Hallazgos posteriores de wiring y reanudación

La aprobación focal de C corresponde al componente de almacenamiento y ledger,
no al flujo completo de UI. Al revisar el inicio real del REPL se detectó que
`index.ts` no invoca `SessionStore.save`; `autoSaveInterval` es configuración
sin consumidor. Las menciones anteriores a autosave describían una expectativa
documental, **no comportamiento ejecutado**. Se corrigen expresamente: sin ese
wiring una sesión nueva no genera el snapshot que `/resume` lista. Se pidió
guardar una entrada inicial antes de acciones y snapshots en fronteras de turno,
incluidas cancelación/error, con evidencia del flujo de inicio y reapertura.
El FileRuntimeSessionStore incorporado al REPL conserva el ledger de acciones,
pero no sustituye esa conexión del transcript de conversación al listado.

En A se encontró otro P1 y se reprodujo sin modificar archivos: intentar
`resumeTurn` sobre un turno completado rechaza la operación y su catch cambia
el estado de `completed` a `failed`, dejando `canResume: true`. Se pidió validar
la admisión antes del catch mutante y probar dos rechazos consecutivos con
snapshot intacto. Las 94 pruebas focales de A ejecutadas por el auditor pasan,
pero no cubrían este caso. A sigue pendiente de corregirlo antes de aprobación.

## Resolución de los hallazgos de integración

El rechazo de reanudación completada se valida ahora antes de entrar en el catch
que modifica estado. Reproducción independiente posterior: dos rechazos, estado
`completed`, `canResume: false` y snapshot sin cambios. El P1 queda corregido.

El inicio del REPL conecta ahora FileRuntimeSessionStore para el ledger y guarda
una sesión inicial antes del primer input; pasa un callback de snapshot esperado
al inicio de cada iteración, después de añadir la petición, y guarda al retornar
el turno. Esto sustituye la anterior configuración de autosave sin consumidor;
no introduce un temporizador. La precedencia de `/resume` usa el ledger durable
más reciente y mantiene las reglas actuales del host sobre permisos/modelo.
El auditor ejecutó **24/24** pruebas de fronteras de checkpoint, resume y snapshot,
y **28/28** de la suite separada de REPL sobre este wiring. La suite de REPL
usa mocks: estos números no constituyen una conversación real con modelo.

La durabilidad queda delimitada: el ledger de acciones tiene patches de disco
antes/después del dispatch; la conversación REPL tiene snapshots por frontera.
Un efecto iniciado sin resultado continúa siendo incierto y exige inspección;
no hay transacción exactly-once sobre shell/MCP, exclusión multiproceso ni
garantía de fsync. El transcript completo del runner runtime se conserva para
auditoría; su compactación afecta a la vista de petición y no elimina ese archivo.
Quedan pendientes la aprobación final de A, resultados externos y checks globales.

## Cierre focal de A y del wiring

El auditor ejecutó **98/98 pruebas aprobadas** en transcript, runner con
herramientas, runtime y headless sobre el bloque congelado. Se verificaron
intención/resultado persistidos, reapertura después de fallo, incertidumbre tras
fallo de persistencia, resolución host sin replay, lotes parcialmente cancelados,
guardia por sesión, metadata fresca, streaming de herramientas con salida final
en bloque e ID recuperable en errores, permisos de archivo 0600 y consumo
observado acumulado al reanudar. La salida en bloque no es streaming incremental
de tokens. El proveedor y los efectos de estos fixtures son controlados; no se
confunden con una evaluación viva externa.

El wiring final del REPL guarda también tras comandos slash/intenciones y en
`finally`, intenta liberar recursos aunque falle el snapshot y tiene aserciones
de guardado inicial/final y selección del store de archivos. La suite separada
vuelta a ejecutar por el auditor pasa **28/28** con esas aserciones.

Dictamen: A aprobado en su alcance focal. Continuidad/contexto/recuperación pasa
de **2 a 3/5** por la integración funcional verificada; herramientas permanece
en **3/5**. La nota 4 requiere todavía escenarios externos amplios; eficiencia
sigue ND y no se calcula total. Se detectó al cierre un fallo de integración
de compilación en el logger de `finally`, comunicado a la coordinadora; es
requisito del gate integrado corregirlo y ejecutar los checks finales.

## Puntuaciones por revisión incremental

Se conserva la rúbrica original. Son juicios de capacidad con evidencia de código
y pruebas, no notas de rendimiento de los modelos ni snapshots independientes
de cada rama: los grupos se desarrollaron concurrentemente en el mismo árbol.
Una celda sin cambio no acredita una nueva evaluación amplia de esa dimensión.

| Dimensión (peso) | Base `78fdac6` | Revisión B | Revisión C | A/B/C integrados antes de gate final |
| --- | ---: | ---: | ---: | ---: |
| Finalización/verificación (20) | 2 | 2 | 3 | 3, provisional por hallazgo CLI descrito abajo |
| Continuidad/contexto/recuperación (15) | 2 | 2 | 2 | 3 |
| Edición/comprensión del repo (15) | 3 | 3 | 3 | 3 |
| Herramientas (10) | 3 | 3 | 3 | 3 |
| Planificación/adaptación (10) | 2 | 2 | 3 | 3 |
| Delegación (10) | 3 | 3 | 3 | 3 |
| UX/control (5) | 3 | 3 | 3 | 3 |
| Permisos/aislamiento (5) | 3 | 3 | 3 | 3 |
| Observabilidad/reproducibilidad (5) | 3 | 3 | 3 | 3 |
| Eficiencia (5) | ND | ND | ND | ND |

Confianza alta en los cambios de continuidad y plan/checks por revisión y
regresiones; media en dimensiones sin nueva evaluación amplia. No se calcula
total con ND ni se trasladan scores funcionales del evaluador a esta escala.
La comparación documental de otros productos permanece separada.

En la última revisión integrada se encontró otro P1 en la ruta headless
histórica: convierte un `AgentTurnResult` con `aborted: false` y `error` en
`success: true`, porque sólo comprueba `aborted`. Los errores terminales de
overflow de B pueden alcanzar esa ruta. Se pidió propagar `turn.error`, devolver
fallo y añadir regresión sobre la salida JSON. El runner runtime ya falla por
excepción en ese caso. El gate integrado queda pendiente de esta corrección y
de los checks finales; aprobar componentes por separado no borra este hallazgo.

## Evidencia externa intermedia recibida

El evaluador independiente comunicó **17/17 contratos deterministas finales**:
core 5/5, almacenamiento 2/2, ledger 7/7 y recuperación 3/3. Incluyen rechazo de
resume completado sin mutación, bloqueo de efecto incierto hasta resolución del
host sin repetir y cancelación posterior al efecto. No son 17 turnos de modelo.
La referencia obtuvo core 1/5 y almacenamiento 0/2; los contratos adicionales
se reportan como tales, sin inventarles una ejecución histórica.

La evaluación viva final de Coco todavía está pendiente al recibir estos datos.
La referencia viva tiene 17/18 turnos y grupos 100/90/100, cuya media es 96,67;
esa media no equivale al porcentaje aritmético de turnos. OpenCode obtuvo 18/18
turnos y 95/95 criterios en sus escenarios. Son tres aplicaciones pequeñas,
Coco runtime embebido con cuatro herramientas frente a OpenCode CLI restringido,
no una comparación general de productos ni de la UI REPL completa.

Se usó `gpt-6-luna`: medium se capturó en HTTP para Coco, mientras para OpenCode
se comprobó configuración/variante CLI sin capturar el request HTTP. Hay un
límite lógico de 4096 en el harness de referencia de Coco cuya presencia en el
wire no estaba acreditada. El consumo de OpenCode incluye cache y omite algunas
peticiones auxiliares; el de referencia de Coco es un límite inferior y pierde
historial de herramientas. No se comparan eficiencia ni facturación con esos
datos. Estos resultados no justifican todavía elevar la rúbrica a 4/5 o 5/5.

## Dictamen integrado con la evaluación final

El evaluador entregó su informe final sobre el snapshot de fuentes
`48077a1ec1abc10db94f9b10fe4ead6d34dbeee995ddae92d155474f9eea3756`.
Los cambios posteriores del host de aprobación y de manejo de errores headless
se revisaron separadamente; no se presentan como otra ejecución viva completa.

| Evidencia observada | Coco base | Coco final | OpenCode |
| --- | ---: | ---: | ---: |
| Media de los tres grupos | 96,67 | 98,89 | 100 |
| Criterios comunes | 92/95 | 94/95 | 95/95 |
| Turnos con respuesta terminal | 17/18 | 17/18 | 18/18 |
| Casos reservados de Coco | No ejecutados | 13/13 | No aplicados |
| Lifecycle determinista | 1/5 | 5/5 | No ejecutado |
| Almacenamiento determinista | 0/2 | 2/2 | No ejecutado |

El final pasa **17/17 contratos externos** contando ledger y recuperación.
La mejora de la media común es **2,22 puntos**, sin mejorar el número de turnos
terminales. Se conservó el fallo final de transporte `terminated` (82,6 s) en
el grupo de contexto; los cinco turnos siguientes pasan. La referencia conservó
un `fetch failed` distinto, sin sustituir ninguno por una repetición exitosa.
La compactación explícita del host redujo 15.485 a 1.179 tokens estimados y la
continuación conservó restricciones/correcciones. Esto acredita esa compactación
explícita; la recuperación automática de overflow se verifica por separado.

Los tokens y tiempos excluyen peticiones y consumos no disponibles, y el cache
de OpenCode se contabiliza aparte. El informe final precisa que 4096 solicitado
por Coco no apareció en el wire del adaptador: los límites efectivos comunes
acreditados son 12 iteraciones y 120 s por turno. Se mantienen todas las demás
limitaciones de comparabilidad anteriores, incluido effort HTTP de OpenCode ND.
No se acredita paridad general, superioridad, menor coste ni mejor eficiencia.

El auditor verificó además **71/71 pruebas** en transcript, runner y headless
tras añadir aprobaciones efímeras del host: las concesiones actuales se aplican
por huella de llamada, cambios de comando/cwd/env se rechazan, el callback recibe
copia defensiva y no se persiste consentimiento. Plan/política siguen pudiendo
prohibir la acción. El P1 de falso éxito headless se corrigió propagando el error
terminal y exigiendo ausencia de error para declarar éxito.

Dictamen de revisión lógica integrada: **favorable**, condicionado al gate global
de la coordinadora sobre los archivos finales. No quedan bloqueadores de esta
revisión identificados. La rúbrica final queda igual que la tabla incremental,
excepto continuidad/contexto/recuperación **4/5**, con confianza media y alcance
limitado al runtime/store de archivos y escenarios acreditados; finalización/
verificación **3/5** deja de ser provisional. Las otras ocho dimensiones conservan
sus notas y eficiencia sigue ND. No hay 5/5 ni total agregado: falta repetibilidad
amplia, más proveedores y mediciones homologadas de eficiencia.

## Confirmación del gate final

La coordinadora confirmó los checks sobre las fuentes finales, sin cambios de
código posteriores: cobertura en **413 archivos**, **8.546 pruebas aprobadas**
y **15 omitidas**; sentencias **80,45 %**, ramas **71,58 %**, funciones **82,54 %**
y líneas **81,27 %**. Confirmó también typecheck, formato, build, **28/28** pruebas
de la suite separada de REPL y typecheck de las cinco aplicaciones del workspace.
Lint termina sin errores y conserva una advertencia previa sobre el thenable de
`owned-shell`. Estos resultados globales se atribuyen a la coordinadora; las
ejecuciones focales propias del auditor están identificadas en cada revisión.

Se levanta la condición de checks globales del dictamen anterior. La auditoría
queda cerrada favorablemente en el alcance documentado, sin convertir ese gate
en una afirmación de superioridad general ni eliminar el fallo de transporte
observado en la evaluación final.
