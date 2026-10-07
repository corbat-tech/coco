# E05 · MCP y autoridad delegada

## E05.a · DONE · 2026-09-16

El wrapper MCP asigna procedencia host (servidor/tool) a la definición. La política común trata efectos remotos desconocidos con el máximo riesgo existente, exige consentimiento en build/debug y bloquea ejecución en ask/plan/review/architect. Ni categorías alternativas, prefijos personalizados ni hints remotos convierten la tool en lectura autorizada. Las confirmaciones de tools desconocidas muestran argumentos completos.

20 casos por `/root/core_audit` (19 fallan antes, incluyendo assertions de clasificación/procedencia; no se presentan como 19 exploits distintos). Matrices usan wrapper, registry y runtime reales con cliente remoto simulado y contador de efectos. Con consumidores: 19 archivos / 454 tests correctos; typecheck/lint correctos. Logs `mcp-permission-{before,after}.log`. Implementación y prueba de UI por coordinador; revisión `/root/baseline_review`: APPROVED sin objeciones materiales.

No hay ejecución remota real ni modificación de schemas/timeouts (E07/E08). Política conservadora predeterminada: una integración host puede establecer una política explícita propia; declaraciones del servidor no bastan. Delegación pendiente, por lo que E05 no está completo. Sin publicación; rollback por revert.

## E05.b · DONE · 2026-09-16

AgentManager entrega objetos y arrays de tools al proveedor hijo como JSON; conserva strings y fallback Success para ausencia/null. Seis casos verifican el mensaje tool_result real del siguiente turno: dos fallan antes, cuatro conservan paridad. Suite de consumidores 4 archivos / 79 tests, y 45 tras extracción final del helper; typecheck/lint correctos. Logs `agent-results-{before,after,final}.log`. Coordinador implementa/tests; revisión `/root/baseline_review`: APPROVED sin hallazgos materiales. E05.a commit `0072d9a`.

Autoridad parental pendiente. Sin publicación; rollback por revert.

## E05.c · DONE · 2026-09-16

Registry transporta un contexto host separado de argumentos del modelo, con callback de delegación y señal de cancelación. Copia y congela el contexto por llamada; combina señales de opciones/contexto y rechaza preabort. Sin contexto ni señal conserva la invocación de un argumento. No introduce estado global ni autoriza por JSON.

Siete casos por `/root/core_audit`: seis fallan antes y uno conserva compatibilidad; después 19 archivos / 214 tests correctos, typecheck/lint correctos. Logs `e05c-before.log` y `e05c-after.log`. Implementación coordinador, revisión `/root/baseline_review`: APPROVED. La cancelación efectiva de procesos/red sigue E07; conexión de autoridad parental pendiente E05.d. Sin publicación; rollback por revert.

## E05.d · DONE · 2026-09-16

RuntimeToolExecutor ofrece delegación ligada al mismo registro/política/eventos/sesión. Cada descendiente respeta los modos y listas de tools de todos sus ancestros, además de su propia restricción. Captura listas por ejecución y política al construir; ninguna confirmación parental o campo extra del hijo se convierte en consentimiento. Señales se combinan.

18 casos por `/root/core_audit`: todos fallan antes por ausencia del callback (no 18 exploits). Después 19 archivos / 220 tests correctos, typecheck/lint/format correctos. Logs `e05d-before.log`, `e05d-after.log`. Mocks de consumidores actualizados para contexto host. Coordinador implementa, `/root/baseline_review` APPROVED sin hallazgos. Conexión de manager/executor pendiente E05.e; E05 no está completo. Sin publicación; rollback por revert.

## E05.e · DONE · 2026-09-16

spawnSimpleAgent y delegateTask pasan contexto host a AgentManager; este y AgentExecutor ejecutan tools mediante el callback parental. Sin contexto, fallback ask de lectura; el rol no concede escritura. AgentExecutor convierte catálogo legacy vacío (todas las tools publicadas) en lista concreta por ejecución. El manager transmite señal interna al despacho.

11 integraciones con runtime, registry y manager reales/proveedor simulado fallan antes; después 21 archivos / 262 tests correctos, typecheck/lint/format correctos. Logs `e05e-before.log`, `e05e-after.log`. Tests `/root/core_audit`, implementación coordinador, revisión `/root/baseline_review` APPROVED. No se ha probado capacidad con LLM real. Cancelación del proveedor pendiente E07; resultado agregado success después de una tool denegada preexistente pendiente E11, por lo que las pruebas afirman autoridad de efectos, no éxito de la tarea. Coherencia de roles pendiente E05.f. Sin publicación; rollback por revert.

## E05.f · DONE · 2026-09-16

Tipos/aliases de delegación centralizados en runtime sin dependencia inversa a CLI/agents. Wrappers y política comparten resolución; cada wrapper usa sus propios campos. delegateTask recibe la misma clasificación por rol. Tipo AgentType reexportado por compatibilidad. docs tiene riesgo write y modo build; mantiene la exigencia de consentimiento por efecto, y su prompt pide entregar propuesta y declarar ausencia de cambios ante denegación. No se incorpora planner al schema legacy de delegateTask (prueba de policy únicamente).

27 casos: 14 fallan antes/13 pasan; después 22 archivos / 289 tests correctos. Typecheck/lint/format correctos. Fitness detectó dependencia inversa en ubicación inicial del helper: trasladado al runtime sin rebajar regla. Regex de prueba de prompt admite proposed documentation además de draft; no acredita comportamiento real del modelo. Logs `e05f-before.log`, `e05f-after.log`. Implementación coordinador; tests `/root/core_audit`; análisis roles `/root/file_fixture_update`; revisión `/root/baseline_review` APPROVED. Gate amplio E05 pendiente antes de cerrar fase. Sin publicación; rollback por revert.

## E05.g · DONE · cierre de fase · 2026-09-16

Gate amplio sobre `a5f9059` y actualización de tres expectativas de mocks REPL para el contexto host: suite principal 315 archivos / 6.980 tests correctos / 15 omitidos, REPL separado 27 correctos, build correcto. Logs `e05-main.log`, `e05-repl.log`, `e05-build.log`. Revisión `/root/baseline_review` APPROVED cierre E05 para autoridad/MCP/roles.

E05 DONE dentro de ese alcance. Permanecen explícitamente cancelación real E07, aislamiento del provider global E10, aceptación/success agregado E11 y evaluación con modelo real E13/E15. No implica que un subagente pueda escribir sin confirmación por operación ni que su autoevaluación pruebe éxito. Sin publicación: otros P0/P1 siguen abiertos. Rollback por revert de los commits E05.
