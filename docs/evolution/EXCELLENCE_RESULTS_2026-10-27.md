# Evaluación externa de Coco — 27 de octubre de 2026

La evaluación medida pasa de **96,67 a 98,89/100** en tres escenarios de conversación con acciones. Los contratos externos de durabilidad/contexto pasan de **20 a 100/100**, los de almacenamiento de **0 a 100/100**, y la versión final supera las **13 comprobaciones reservadas** y los **17 contratos externos**. OpenCode 1.17.10 obtiene **100/100** en los mismos tres escenarios comunes.

Estas cifras describen esta muestra y sus condiciones. No establecen paridad general con OpenCode ni superioridad en coste, velocidad o fiabilidad del proveedor. Ambas ejecuciones de Coco tuvieron una respuesta del proveedor interrumpida, conservada en la puntuación del primer intento.

## Identidad de las versiones y alcance

- Base archivada: `78fdac6ce830505baf5b37929ca5068a9dfddeb9`.
- Modelo solicitado: `gpt-6-luna`, razonamiento `medium`, mediante el OAuth de ChatGPT existente.
- Comparador ejecutado: OpenCode **1.17.10**, instalado localmente; no fue una comparación exclusivamente documental.
- Copia final evaluada: 895 archivos bajo `src/`; SHA-256 de su manifiesto de archivos y hashes: `48077a1ec1abc10db94f9b10fe4ead6d34dbeee995ddae92d155474f9eea3756`.
- Coco se ejecutó como **runtime embebido**, con `createAgentRuntime`, `createToolCallingRuntimeTurnRunner` y `createFileRuntimeSessionStore`. OpenCode se ejecutó con su CLI nativa y permisos restringidos. No se equipara este ensayo con una prueba completa del REPL interactivo.
- El evaluador trabajó fuera del repositorio durante la ejecución y no modificó la aplicación, la rama ni los commits.

Después de congelar esa copia se ajustaron el consentimiento del host y la representación de fallos headless, con cambios en el runner, runtime, tipos y adaptador headless. **El árbol entregado no es idéntico al snapshot de la evaluación en vivo.** Esos ajustes posteriores se verificaron mediante 71 regresiones focales independientes y la validación integrada final; no se repitieron los 18 turnos del modelo para ellos.

## Método y puntuación

Se congelaron tres grupos de **seis turnos**, 18 por versión/producto, con conversación, modificaciones, correcciones del usuario, verificaciones y reanudación. Cada turno tuvo un solo intento puntuado, un máximo de **12 iteraciones** y **120 segundos**. Las pruebas públicas se ejecutaron con Node, sin instalar dependencias.

El host de Coco ofrecía cuatro herramientas: lectura, escritura, listado y ejecución de los tests públicos. Los ficheros estaban confinados al proyecto temporal; solo se podían escribir fuentes bajo `src/`. La herramienta de tests invocaba exactamente Node con `--test test/public.test.mjs`, sin shell arbitrario. OpenCode recibió permisos equivalentes de edición de fuentes y ese comando de tests; el acceso externo y las demás acciones estaban denegados.

Cada criterio fue binario y comprobado externamente: comportamiento del código, conservación de correcciones, resultado de una verificación observada, ausencia de escrituras en turnos conversacionales y, donde correspondía, conservación del identificador de seguimiento. Las puntuaciones heurísticas internas de Coco no participaron.

Los tres grupos pesan lo mismo: la nota global es la media de sus porcentajes, no el porcentaje de todos los criterios sumados. Se mantuvieron **95 criterios comunes**. Las **13 aserciones reservadas** se añadieron únicamente a la evaluación final y se informan por separado, sin alterar el denominador comparable.

### Resultados en vivo

| Grupo | Coco base | Coco final | OpenCode 1.17.10 |
| --- | ---: | ---: | ---: |
| Acciones y correcciones | 28/28 · 100 | 28/28 · 100 | 28/28 · 100 |
| Contexto, compactación y reapertura | 27/30 · 90 | 29/30 · 96,67 | 30/30 · 100 |
| Reanudación y cambios acumulados | 37/37 · 100 | 37/37 · 100 | 37/37 · 100 |
| **Media de grupos** | **96,67** | **98,89** | **100** |
| Criterios comunes superados | 92/95 | 94/95 | 95/95 |
| Turnos con respuesta terminal | 17/18 | 17/18 | 18/18 |
| Aserciones reservadas | No aplicadas | **13/13** | No aplicadas |

En el baseline, el sexto turno del grupo de contexto terminó con `fetch failed` después de 88,8 s. En la versión final, el primer turno de ese grupo terminó con `terminated` después de 82,6 s, tras tres lecturas/listados y sin mutaciones. Sus cinco turnos posteriores continuaron correctamente. Estos incidentes permanecen en las notas; no se sustituyeron por reintentos favorables. Los mensajes observados no permiten atribuir con certeza su causa al producto o al backend.

### Contratos externos por iteración

| Familia | Base | Iteración BC | Final |
| --- | ---: | ---: | ---: |
| Transcript, continuidad, stream y compactación | 1/5 · 20 | 5/5 · 100 | 5/5 · 100 |
| Almacenamiento REPL coherente | 0/2 · 0 | 2/2 · 100 | 2/2 · 100 |
| Plan de trabajo y evidencia observada | API ausente | 7/7 · 100 | 7/7 · 100 |
| Recuperación adversarial explícita | API ausente | No ejecutada | 3/3 · 100 |

La ronda intermedia fue determinista y no consumió llamadas al modelo. La ronda final reconfirmó los **17 contratos** sobre la copia congelada utilizada para las llamadas reales. No se calcula una media artificial que mezcle APIs nuevas ausentes en la base con tareas de programación ya existentes.

## Comportamiento funcional comprobado

El baseline podía resolver las tareas y aun así perdía las llamadas y resultados de herramientas al finalizar cada turno. La versión final conserva ese transcript y lo ofrece al turno siguiente. En el grupo de acciones quedaron **28 bloques de llamada/resultado** persistidos, frente a cero en la base.

Los contratos de recuperación comprobaron un efecto externo no idempotente aplicado una sola vez. Si después falla el proveedor, la reapertura conserva la evidencia. Si falla la persistencia del resultado tras aplicar el efecto, la operación queda incierta y la reanudación se bloquea hasta que el host aporta una reconciliación observada; después continúa sin repetir el efecto. La cancelación posterior al efecto conserva la intención registrada. Intentar reanudar una ejecución ya completada se rechaza sin alterar la sesión ni repetir acciones.

La superficie `streamTurn` configurada con el runner de herramientas ejecutó la misma acción y persistió su evidencia. Su salida es **buffered hasta completar el turno**; esta prueba no demuestra streaming incremental de tokens.

El almacenamiento de sesiones conservó una generación coherente ante un fallo EIO inyectado en la escritura y ante un entrelazado controlado de dos guardados concurrentes. Carga y listado coincidieron en la cantidad y generación de mensajes. Son contratos de `SessionStore`; por sí solos no prueban el flujo completo de inicio y autoguardado de la UI del REPL.

Los siete contratos del plan comprobaron que una declaración de completado o una lectura exitosa no verifican el trabajo; que un ID de evidencia inventado se rechaza; que un test observado y aprobado puede verificar la revisión vigente; que una escritura posterior invalida esa evidencia; que las sesiones no comparten su evidencia; y que una actualización parcial conserva los pasos pendientes.

## Contexto y compactación

La compactación explícita de Coco final redujo el historial de **15.485 a 1.179 tokens estimados**, un **92,4 %**, y la reapertura conservó las correcciones, la API y el identificador `RETOMA-47`. En el baseline, el compactor solo recibió 570 tokens pese a haber leído aproximadamente 53 KB: el runtime ya había descartado los resultados de herramientas. Retuvo esos 570 tokens porque resumir no reducía el contexto; no se cuenta como una compactación conseguida.

La suite en vivo invocó expresamente el compactor existente desde el host y guardó su resultado antes de reabrir la sesión. No debe presentarse como demostración de compactación automática. Un contrato determinista separado forzó un historial largo y verificó reducción, conservación exacta de restricciones y pares completos de llamada/resultado.

En OpenCode se invocó el endpoint nativo de resumen de sesión: respondió HTTP 200 con `true`, y el turno posterior conservó el identificador y las decisiones. No se midió su ratio de reducción.

## Modelo, límites y consumo observado

En Coco se capturaron del cuerpo HTTP el modelo exacto y `reasoning.effort: medium`, con destino `https://chatgpt.com/backend-api/codex/responses`. En OpenCode se comprobaron el modelo en los logs nativos, la configuración `reasoningEffort: medium` y la opción `--variant medium`; **no se capturó su esfuerzo serializado en HTTP**. La igualdad de esfuerzo se configuró, pero su verificación de transporte es asimétrica.

El host solicitó `maxTokens: 4096` a Coco, pero ese límite no apareció como `max_output_tokens` en la petición del adaptador Codex. Por tanto, no se afirma un límite efectivo de 4.096 tokens en el backend ni igualdad de ese límite entre productos. Los límites externos aplicados fueron las 12 iteraciones y los 120 s por turno.

| Ejecución | Input informado | Cache-read separado | Output informado | Tiempo acumulado de turnos |
| --- | ---: | ---: | ---: | ---: |
| Coco base | 131.480 | Sin desglose | 5.193 | 279,7 s |
| Coco final | 193.735 | Sin desglose | 4.346 | 171,4 s |
| OpenCode | 57.450 | 336.000 | 4.957 | 149,1 s |

Son cotas inferiores de uso observado: faltan las llamadas auxiliares de resumen/título y el uso no devuelto en turnos fallidos. En OpenCode, `input` excluye el cache-read informado por separado; en sus eventos el total incluye ambos. El baseline de Coco además enviaba menos historia porque perdía los resultados de herramientas. No son cifras suficientes para concluir ahorro de tokens o comparar eficiencia de forma controlada.

La autenticación utilizó una suscripción existente. El coste cero informado por el catálogo/metadatos de suscripción no es una factura ni prueba de cómputo gratuito. No se midió gasto facturado ni se extrapolaron precios de API.

### Incidencias del host de evaluación

Los primeros intentos de arrancar OpenCode esperaban EOF porque el proceso padre mantenía abierto stdin. Se corrigió cerrándolo; esos intentos no habían creado una sesión de proveedor. Una hipótesis inicial sobre el logging se descartó al identificar la causa.

Otros seis turnos de escenarios utilizaron un patrón de permiso de edición incorrecto del host, que bloqueaba las fuentes. Se anularon como errores del harness y se corrigió el patrón relativo `src/*`. Después se ejecutaron los **18 turnos válidos** de la tabla. Esos seis turnos anulados no se atribuyen a OpenCode ni se ocultan como reintentos exitosos. Los probes de conexión también se excluyeron de las notas.

## Receta para reconstruir la evaluación

Los scripts y resultados crudos fueron temporales y se eliminaron al cerrar. Esta sección conserva el contrato de reproducción; reconstruir el host y realizar una nueva ejecución no garantiza idénticos textos o notas del modelo.

1. Crear fuera del repositorio un espejo del commit base con `git archive 78fdac6`, y otra copia del árbol final. Reutilizar las dependencias locales mediante un enlace a `node_modules`; no instalar globalmente. Identificar ambas fuentes y el manifiesto SHA-256 del snapshot.
2. Crear proyectos Node ESM independientes con `src/`, README y `test/public.test.mjs`, sin dependencias. El evaluador externo debe cargar de nuevo las funciones después de cada turno y ejecutar sus aserciones fuera del proyecto editable.
3. Componer el host de Coco con las tres factorías indicadas arriba y cuatro herramientas confinadas. Usar una sesión de fichero por grupo, modelo `gpt-6-luna`, `thinking: medium`, 12 iteraciones, timeout de 120 s y `maxTokens: 4096` solicitado, registrando lo realmente enviado. Confirmar explícitamente las escrituras del host; el modo headless no concede autoridad por sí mismo.
4. Responder en español y fijar estas reglas comunes: preservar las restricciones y correcciones, inspeccionar antes de editar, no añadir dependencias ni modificar tests, comprobar los cambios cuando se solicite y no afirmar verificaciones no observadas.
5. Ejecutar los seis turnos de cada receta siguiente sin reintentos puntuados; comprobar el comportamiento tras cada turno. Puntuar cada aserción binaria y calcular la media de los tres porcentajes.

| Grupo y fuente inicial | Secuencia de seis turnos | Aceptación externa |
| --- | --- | --- |
| Acciones: `total(lines)` suma `price * quantity` mediante `reduce`; README define importes decimales en euros. Tests públicos: total normal y `total([{price: 0.1, quantity: 3}]) === 0.3`. | Saludo; corregir precisión y verificar; añadir `RangeError` para cantidad negativa y vacío igual a cero; conversación sobre restricciones sin editar; añadir precio negativo y verificar; revisión final con tests. | Precisión decimal, firma pública, vacío, validaciones acumuladas, verificación aprobada y ausencia de escrituras en las pausas conversacionales. |
| Contexto: `enqueue(queue, item)` devuelve `[...queue, item]`; README exige inmutabilidad y objetos con `id`/`value`. Añadir 600 líneas de referencia histórica sin nuevas exigencias, aproximadamente 53 KB. Test público: añadir a una cola vacía sin mutarla. | Establecer inmutabilidad, IDs sensibles a mayúsculas y `RETOMA-47`, e inspeccionar; deduplicar por ID sustituyendo en posición; corregir para conservar el primer objeto y devolver array nuevo; conversación sobre contrato/identificador; validar ID vacío o ausente con `TypeError`; compactar, reabrir y verificar sin cambiar API. | Dedupe según la última corrección, nueva referencia sin mutación, `A` y `a` distintos, validación, verificación aprobada e identificador retenido. |
| Reanudación: `resolveConfig(base, override)` empieza como spread superficial; README prohíbe mutaciones. Test público: un override normal sustituye el valor. | Implementar `undefined` como ausencia; aclarar que `null` reemplaza; conversación sin editar; reabrir y pedir merge recursivo de objetos simples, sustituyendo arrays; preservar las reglas también anidadas; tests y resumen final. | Ausencia con `undefined`, sustitución con `null`, entradas intactas, merge recursivo, arrays sustituidos y verificaciones reales. |

Las 13 comprobaciones reservadas originales se mantuvieron ocultas durante el desarrollo: cinco de importes decimales, cinco de posición/deduplicación y tres de merge recursivo. Una nueva ronda debe reservar variantes nuevas antes de comenzar, sin ajustar sus expectativas a las soluciones generadas.

Para reconstruir los contratos deterministas, inyectar un proveedor que solicite primero una herramienta con efecto no idempotente y después termine o lance un error. Comprobar el transcript persistido, la entrada al segundo turno y la reapertura. Inyectar además un fallo al persistir el resultado tras el efecto, inspeccionar la incertidumbre, comprobar que `resumeTurn` rechaza repetirla y resolverla mediante evidencia explícita del host antes de continuar. Probar por separado cancelación posterior al efecto y rechazo inmutable de reanudar un turno completado.

En `SessionStore`, guardar una generación válida, inyectar EIO al escribir la conversación y comprobar que carga/listado describen la misma generación coherente. Para concurrencia, intercalar de manera controlada dos guardados con diferentes números y contenidos de mensajes, y comprobar que no se mezclan generaciones. Para el plan, usar `read_plan`/`update_plan` a través del runtime, con una lectura, una escritura y un test que devuelva éxito/exit code observados; comprobar los siete contratos descritos arriba y el aislamiento entre dos sesiones.

Para OpenCode, usar XDG config/data/state/cache aislados y una copia temporal del mismo OAuth, sin alterar las credenciales originales ni permitir su renovación. Ejecutar `opencode run --pure --format json --model openai/gpt-6-luna --variant medium --session <id>` a partir del segundo turno; cerrar stdin del proceso hijo y restringir permisos de archivos y shell. Usar el resumen nativo de sesión para la compactación. La documentación oficial de [permisos](https://opencode.ai/docs/permissions/), [modelos](https://opencode.ai/docs/models/) y [servidor](https://opencode.ai/docs/server/) orientó esta configuración; las notas de la tabla provienen de las ejecuciones observadas.

## Validación integrada del árbol entregado

La coordinadora comunicó los siguientes gates finales, ejecutados sobre el árbol entregado después de los ajustes posteriores al snapshot en vivo:

- **8.546 tests aprobados, 15 omitidos, 413 archivos** en la suite general.
- **28 tests REPL** aprobados.
- Cobertura: **81,27 % líneas**, **80,45 % sentencias**, **82,54 % funciones**, **71,58 % ramas**.
- Lint, formato, tipos, build y comprobación de tipos de las **cinco aplicaciones** aprobados.

Estas cifras proceden de la validación integrada de la coordinadora y se distinguen de los 17 contratos externos ejecutados por el evaluador. La mejora principal comprobada es que el trabajo conserva sus acciones, incertidumbres, correcciones y evidencia al continuar; las muestras en vivo siguen siendo pequeñas y conservan sus fallos de proveedor.
