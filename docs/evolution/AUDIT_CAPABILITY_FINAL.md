# Auditoría final de capacidad y evidencia

Fecha: 17 de septiembre de 2026. Revisión en solo lectura del evaluador y sus resultados; no se modificaron corpus ni prompts y no se ejecutó inferencia desde esta auditoría. Un defecto de finalización descubierto al seguir sus resultados motivó una corrección autorizada del runtime, descrita abajo.

## Dictamen final de esta revisión

**Recomiendo mantener RC2 como candidata para piloto local supervisado y no promover todavía a estable. La evidencia muestra capacidad útil, pero no cierra el objetivo de uso fiable por un consultor sin contexto. No acredita autonomía general ni superioridad frente a otros agentes.** Los 20 casos repetidos del candidato `7fb9aca` completaron sus turnos, superaron sus verificadores externos y conservaron el archivo protegido. No son 20 tareas independientes: son cinco tareas repetidas dos veces con dos modelos.

Los seis reservados del candidato `34f4a7c` terminaron: **2/6 aprobados completos, 4/6 con código verificado y 3/6 con todos sus turnos terminados**. Qwen 3.5 4B obtuvo 0/3 y 9B obtuvo 2/3, ambos con `thinking: off` explícito. Son tres tareas por dos perfiles, no una estimación estadística de la capacidad general ni una evaluación equivalente de la configuración predeterminada/auto.

Los reservados descubrieron además un P1 productivo de falso éxito ante respuestas incompletas. La corrección de RC2 (`5bd23ef`) tiene pruebas enfocadas y revisión independiente favorables; el integrador confirmó su gate exacto: 8.337 tests principales y 28 REPL, 80,02% statements y 80,75% líneas, typecheck/lint/format/build e instalación limpia aprobados. Ese cierre mejora la integridad del resultado, pero no cambia retrospectivamente los fallos de generación/terminación observados. Una RC2 instalable permite continuar pilotos supervisados sin afirmar que el criterio de suficiencia del plan ya está cumplido.

## Método y procedencia

Esta es una revisión informada de otro agente que conoce el desarrollo. No es un consultor humano independiente ni una prueba ciega de uso. Se leyeron:

- `scripts/eval-ollama.mjs`: ejecución de un paquete instalado, proveedor Ollama local y seis herramientas.
- `evidence/heldout-cases-v1.json`: tres casos reservados congelados, sin alterarlos.
- `evidence/next8-ollama-repeated-v3.json`: agregado con commit, modelos/digests, hashes de entradas del paquete, resultados y código final.
- `evidence/next8-ollama-heldout-v1.json`: seis reservados completos con resultados y eventos persistidos.
- Eventos y respuestas completos en los directorios `next8-preaudit-{4b,9b}-r{1,2}` del espacio temporal de validación.
- `evidence/ollama-blind-product-audit.json`: lectura documental por un modelo local sin historial de desarrollo, con input hash y metadatos de inferencia.

El script usa `qwen3.5:4b` y `qwen3.5:9b` ya instalados, con `thinking: off` explícito, sin descarga ni proveedor de pago. Una ronda admite como máximo 30 llamadas al modelo por caso, compartidas por los dos turnos cuando existen; el runner también limita iteraciones. Hay señal de cancelación a los diez minutos, timeout de proveedor de 120 segundos, salida máxima de 4.096 tokens por respuesta y verificador Node separado con timeout de diez segundos. La señal constituye un límite operativo, no una garantía de tiempo exacto de pared frente a cualquier fallo del host.

`passed` exige ausencia de error, terminación válida de todos los turnos sin herramientas pendientes/truncamiento, salida cero del verificador y conservación de `USER_NOTE.txt`. `agentCompleted` y `codeVerified` se guardan por separado. El verificador usa assertions escritas fuera del agente; no depende de que el modelo diga haber probado su trabajo.

Los hashes de `run.json` corresponden a tres puntos de entrada del paquete, no a cada archivo de su distribución. La identidad del artefacto completo requiere además el tarball/integridad verificados por el integrador. Una ejecución incompleta o sin informe no puede contarse como aprobada.

## Resultados repetidos observados

| Paquete/modelo | Repetición | Casos aprobados | Llamadas totales | Tiempo de los cinco casos |
| --- | ---: | ---: | ---: | ---: |
| Candidato `7fb9aca`, Qwen 3.5 4B | 1 | 5/5 | 28 | 93,1 s |
| Candidato `7fb9aca`, Qwen 3.5 4B | 2 | 5/5 | 29 | 116,7 s |
| Candidato `7fb9aca`, Qwen 3.5 9B | 1 | 5/5 | 31 | 248,8 s |
| Candidato `7fb9aca`, Qwen 3.5 9B | 2 | 5/5 | 34 | 243,6 s |

Los límites de llamadas son por caso, no por esta suma de cinco casos. Estos tiempos describen esta máquina y ejecución; no son SLA ni benchmark comparativo. `thinking: off` era ignorado en la referencia next.4 y se respeta en el candidato: una diferencia de velocidad no aísla el efecto de la arquitectura. El evaluador anterior tampoco capturaba terminación con la misma exigencia que v3, por lo que no procede presentar porcentajes de mejora directa entre ambas referencias.

## Qué verifica cada grupo y qué queda fuera

- **Bug/función/refactor:** ejemplos concretos de resultados, exportación y caso vacío. El refactor usa un proxy para comprobar una lectura por elemento y objetos congelados para detectar mutación. No cubren integración de múltiples paquetes, tipado complejo, concurrencia ni rendimiento a escala.
- **Recuperación:** corrige la función y exige resultados con cero, negativo y positivo. El assertion final no exige por sí solo intentar la lectura fallida ni explicar el fallo. La inspección adicional muestra que 4B realiza una lectura fallida y después continúa; 9B utiliza comprobaciones de existencia, y su fallo de herramienta registrado es de shell. Todas las respuestas finales reconocen que faltaba el archivo. No se acredita que los cuatro recorridos ejerciten exactamente la misma recuperación de lectura.
- **Sesión:** dos turnos conservan restricciones visibles y archivo protegido. En los cuatro registros, el primer turno solo invoca dos lecturas, sin escritura ni shell, coherente con «no editar aún». Esto es revisión adicional de eventos, no una condición del assertion final. No es una sesión larga ni estrés de compactación.
- **Reservado de orden:** exige deduplicación por última ocurrencia, orden correcto, referencias originales y ausencia de mutación en la muestra congelada.
- **Reservado de rutas:** comprueba normalización POSIX, raíz, prefijos hermanos, traversal y raíz `/`. No comprueba enlaces reales ni promete validación de Windows.
- **Reservado de corrección:** exige adoptar `enabled === true`, excluir valores ausentes/falsos/cadena, conservar negativos/cero y restricciones anteriores. Los números decimales usados no descartan toda forma de redondeo; la revisión del código final debe contrastar también esa prohibición.

Las restricciones «sin dependencias», «sin red» y «no usar Git» están en el prompt; no forman todas parte de los assertions. El aislamiento real depende del sandbox externo. La autorización explícita de shell permite ejecutar verificaciones, y este corpus no demuestra una defensa frente a un agente adversarial que intentase manipular el evaluador.

Las respuestas narrativas no son evidencia adicional. Por ejemplo, una respuesta aprobada afirma que `toLowerCase()` solo transforma letras ASCII, una explicación incorrecta aunque los casos ASCII solicitados pasen. Los tests y el diff siguen siendo la fuente para decidir aceptación.

El campo diagnóstico `completionFailure` puede etiquetar truncamiento como agotamiento de herramientas y omitir un fallo de primer turno si el último terminó. El booleano de aceptación revisado sí rechaza esos casos mediante `turnCompletions`; es un límite del diagnóstico, no evidencia de falsos aprobados en estos resultados.

## Primer resultado reservado: fallo de terminación, código correcto

En `34f4a7c`, `heldout-order` con Qwen 3.5 4B registró `passed: false`, `codeVerified: true`, `agentCompleted: false`, 24 llamadas y 348,9 segundos. El código final conserva la última ocurrencia por identificador y ordena por esas posiciones; el verificador externo aprobó y el archivo protegido quedó intacto. Sus 23 ejecuciones de herramientas finalizaron sin error registrado. La respuesta final anuncia que ejecutará otra prueba, sin terminar válidamente el turno.

Aunque el campo `completionFailure` dice `tool_budget_exhausted`, **no puede atribuirse al límite de 30 iteraciones**: en este caso de un turno hubo 24 llamadas, y el runner efectúa una por iteración. La salida anticipada ocurre cuando el proveedor no indica `tool_use` o no devuelve herramientas. El evaluador detectó un final no aceptable, compatible con truncamiento o una respuesta terminal inconsistente. No se guardó el `stopReason` final bruto y no es posible distinguir retrospectivamente esas causas. No se modifica el caso ni se repite para ocultar el fallo.

Dictamen de este caso: limitación real de terminación/eficiencia bajo ese modelo y presupuesto, sin evidencia de corrupción, fallo de herramientas o pérdida de permisos. El evaluador externo impide contarlo como éxito, pero seguir la ruta productiva reveló un defecto adicional bloqueante: `--runtime-runner` podía devolver JSON `success: true` y salida cero para esa misma respuesta no terminal. No procede reportarlo como aprobado solo porque su código sea correcto.

## Bloqueante de finalización del runtime y corrección

El runner experimental retornaba normalmente ante `max_tokens`, combinaciones inconsistentes de motivo/herramientas y agotamiento de iteraciones. El runner de chat por defecto tampoco validaba el motivo final. `streamTurn` aceptaba incluso un stream sin evento terminal y persistía el texto como turno completado. Esto permite que un consumidor automatizado confunda trabajo incompleto con éxito; es un P1 verificable, independientemente del tamaño del modelo.

La corrección acotada rechaza esas respuestas antes de persistir un turno exitoso. Solo acepta `end_turn` o `stop_sequence` sin herramientas pendientes; el runner con herramientas exige `tool_use` con llamadas, y su presupuesto debe ser un entero positivo seguro. El stream puede haber emitido texto parcial, pero termina en `error`, sin `done` ni `turn.completed`, si falta un terminal válido o aparecen herramientas. Se comprueba cancelación antes y después del proveedor. Los efectos ya ejecutados se conservan y el error indica que deben inspeccionarse; no hay rollback automático ni reintentos que oculten el fallo.

Validación aislada final comunicada por el integrador: 74 tests aprobados entre runner, runtime y headless. Incluye presupuesto agotado, truncamiento, respuestas inconsistentes, cancelación tardía, historial sin falsa aceptación y JSON de fracaso con cierre del runtime. El typecheck completo aislado también aprobó. La revisión independiente de otro agente cerró el hallazgo sin bloqueantes. Se añadió además una comprobación entre herramientas de un mismo batch para impedir ejecutar la siguiente tras una cancelación. Esto no acredita cancelar todos los efectos de una herramienta ya activa. El integrador confirmó el gate exacto de RC2 y la instalación limpia aprobados. Estas pruebas de contrato no convierten en aprobados los casos reservados anteriores ni sustituyen sus resultados reales.

## Tres reservados 4B: resultado completo

| Caso | Turno completado | Código verificado | Resultado global |
| --- | --- | --- | --- |
| Orden | No | Sí | Fallo |
| Rutas | No | No | Fallo |
| Corrección de instrucciones | Sí, ambos turnos | No | Fallo |

El caso de rutas consumió 27 llamadas y 306,2 segundos. Su código elimina los segmentos `..` pero no el segmento precedente, por lo que acepta una ruta fuera de la raíz. El caso de corrección consumió cuatro llamadas y 15,4 segundos; reconoce verbalmente `enabled === true` pero mantiene la función original y espera otra autorización, conservando la instrucción anterior de no editar pese al segundo turno. El verificador obtiene 29 en vez de 2. Los tres conservaron el archivo protegido.

Son fallos reales de generación y seguimiento de instrucciones bajo el perfil Qwen 3.5 4B con `thinking: off` explícito y los límites del evaluador. El producto conserva su configuración predeterminada/auto: estos resultados no cuantifican su calidad en otros modos, modelos o presupuestos. Los eventos disponibles no demuestran un fallo de infraestructura que justifique descartarlos. Recomendar una estable supervisada requiere publicar estas limitaciones, mantener revisión externa del diff y tests, y no presentar los 20 repetidos previos como representativos de tareas nuevas. Los tres casos 9B también terminaron y se detallan a continuación.

## Tres reservados 9B y adjudicación conjunta

| Caso | Llamadas | Tiempo | Turno completado | Código verificado | Resultado global |
| --- | ---: | ---: | --- | --- | --- |
| Orden | 9 | 127,1 s | Sí | Sí | Aprobado |
| Rutas | 26 | 489,9 s | No | Sí | Fallo |
| Corrección de instrucciones | 5 | 38,9 s | Sí, ambos turnos | Sí | Aprobado |

La deduplicación 9B usa dos pasadas, conserva referencias y orden de últimas posiciones. Su `Set` adicional es redundante, pero no invalida el contrato comprobado. La corrección 9B aplica `enabled === true` sin redondeo ni dependencias, conserva negativos/cero y supera los assertions; la inspección del código confirma la restricción de no redondear que las muestras decimales por sí solas no agotaban.

En rutas 9B, el código resuelve correctamente `..` mediante una pila y supera los casos POSIX pedidos, pero la respuesta sigue intentando investigar después de 26 llamadas. No hubo final válido: no se cuenta como éxito. Como en los finales incompletos 4B, el diagnóstico guardado no permite atribuir con precisión truncamiento frente a otra inconsistencia terminal. Los seis archivos protegidos se conservaron.

La comparación útil es interna y acotada: el corpus repetido previo aprobaba 20/20, mientras los reservados exponen dificultades adicionales en finalización y seguimiento de instrucciones. No se ha demostrado que aumentar presupuesto, habilitar razonamiento o cambiar modelo solucione todas ellas. Tampoco se ha demostrado un fallo de Coco en todos sus modos: el perfil y la tarea importan. No se modificaron prompts, casos ni verificadores para mejorar estos resultados.

## Adjudicación de la revisión documental ciega

El archivo `ollama-blind-product-audit.json` registra Qwen 3.5 9B leyendo documentos suministrados, sin interacción con Coco. Su veredicto `PREVIEW_WITH_RESTRICTIONS` expresa una impresión documental sobre la preview descrita, no un dictamen humano ni una prueba del candidato estable.

| Afirmación del modelo revisor | Adjudicación |
| --- | --- |
| Runtime reutilizable y separación respecto del CLI | Sustentado por la estructura y exportaciones inspeccionadas. La facilidad de crear un producto empresarial es una inferencia; requiere herramientas, autoridad y aislamiento propios. |
| Plan estricto evita cambios destructivos | Intención respaldada por política y tests, pero no aceptar como garantía global. La auditoría de ingeniería posterior encontró `git_branch` e imágenes mal clasificados; se corrigieron y revisaron. Esto demuestra el límite de una evaluación solo documental. |
| Más robusto que wrappers estándar por retries/circuit-breaker | La existencia de mecanismos es comprobable. La superioridad comparativa no se ha medido y no se adopta. |
| Evidencia explícita impide aceptar puntuaciones inventadas | Sustentado para la ruta medida y los gates revisados. No significa que el LLM nunca produzca afirmaciones falsas ni que cada consumidor aplique automáticamente el gate. |
| Interoperabilidad de skills/MCP | Convenciones y descubrimiento reutilizables comprobados. No certifica compatibilidad de cualquier skill o servidor externo ni sus permisos. |
| Windows exige WSL2 para funcionalidad completa | Background nativo no certificado es una limitación real. «WSL2 ofrece funcionalidad completa» no está probado aquí; no se adopta esa inferencia. |
| `/quality` no verificado y seguridad estática no equivalente a pentest | Limitaciones correctas y necesarias, no bloqueantes por sí mismas para un piloto supervisado que use verificación externa. |
| Proyectos sin tests reciben puntuaciones bajas aunque sean correctos | Matiz necesario: también pueden producir evidencia no disponible/incompleta y no ser aceptables; no siempre existe una puntuación válida baja. |
| El producto está en preview | Correcto respecto de los documentos suministrados. El estado de publicación debe comprobarse por versión/canal, no por el veredicto del modelo. |

## Condiciones pendientes para una futura promoción estable

1. **Cerrado por el integrador:** publicación e integridad de RC2 verificadas, Actions `35270377516` PASS, npm next y cuatro assets GitHub. Gate completo e instalación limpia aprobados. Los seis reservados corresponden a `34f4a7c`, no al binario corregido `5bd23ef`.
2. Obtener una pequeña prueba de uso real de un consultor sin historial del desarrollo, con tareas representativas y verificación externa del diff. La revisión documental por otro modelo no cumple esta condición.
3. Validar el perfil/modelo que se vaya a recomendar al usuario en condiciones equivalentes, manteniendo visibles también los fallos. No es necesario ejecutar más inferencias para cerrar esta entrega como RC2.
4. Conservar estos resultados y los límites de alcance; no transformar código correcto sin final válido en un aprobado ni ocultar el caso de código incorrecto.

No propongo ampliar funciones, migrar arquitectura ni ajustar prompts contra estos reservados. La entrega puede cerrarse ahora como **RC2 para piloto supervisado**, con tareas futuras pequeñas y medibles. La calidad de ingeniería y el resultado de las pruebas automáticas justifican probarla; la evidencia de capacidad y uso disponible todavía no justifica dar por terminada la promesa del plan de una estable validada por uso independiente.
