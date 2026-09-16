# E03 · Frontera de ejecución

## E03.a · DONE · 2026-09-16

AgentRuntime delega permisos y ejecución en RuntimeToolExecutor, conservando validación de tenant/sesión, precedencia de modo, decisiones y contratos de eventos. El perfil del API conserva privacidad de metadata y no añade eventos de agente. No se cambia la autoridad concedida.

Seis pruebas nuevas de caracterización pasan antes y después: aislamiento de sesiones concurrentes, rechazo de sesión desconocida antes de consultar tools, política dependiente de input, eventos, privacidad, errores de validación/ejecución y despacho único. Después: 22 archivos / 225 pruebas de runtime, agentes y swarm pasan en Node 22.23.2 aislado. Typecheck, lint y formato pasan. Logs locales: `.dev/evolution/e01-baseline/logs/runtime-{before,contract-before,after}.log`.

Revisor independiente: `/root/baseline_review`, APPROVED, sin defectos materiales. Tests de contrato aportados por `/root/core_audit`; implementación por coordinador. Rollback: revertir el commit de este incremento. Sin publicación: todavía hay bloqueantes abiertos del programa.

E03 sigue IN_PROGRESS: REPL/headless aún ejecutan por un alias del registry; la prueba de arquitectura textual no detecta esos alias. Integración, detección del bypass y matriz completa pendientes. No se declara una frontera universal todavía.

## E03.b · DONE · 2026-09-16

Preparación de integración: el API/runtime acepta y transmite AbortSignal al registry. Una cancelación previa impide efectos reales, y cada ejecución concurrente conserva su propia señal. No afirma detener procesos en curso: ToolDefinition todavía no recibe contexto de ejecución; eso corresponde a E07.

Regresión: las dos nuevas pruebas fallan antes de propagar la señal. Ajustado el spy de un consumidor a la llamada con opciones explícitas. Validación: 22 archivos / 227 tests pasan, typecheck y lint correctos. Revisor `/root/baseline_review`: APPROVED, sin hallazgos materiales. Sin publicación; rollback por revert. logs `runtime-signal-before.log` y `runtime-signal-after.log`.

## E03.c · DONE · 2026-09-16

Corregido retorno prematuro del coordinador paralelo: Promise.all solo esperaba la primera tanda aunque callbacks encolasen nuevas herramientas. Ahora drena las tandas añadidas, conserva orden y limpia timer/listener al salir. Dos regresiones fallan antes y pasan después. Siete archivos / 62 pruebas (scheduler, recuperación y e2e), typecheck/lint/diff-check correctos. Logs locales `parallel-lifecycle-{before,after}.log`. Revisor `/root/baseline_review`: APPROVED. Rollback por revert; sin publicación. Cancelación/timeout efectivo de procesos sigue pendiente de E07.

## E03.d · DONE · 2026-09-16

REPL y su consumidor headless usan AgentRuntime para despachar herramientas; el coordinador paralelo recibe una función de ejecución obligatoria, sin registry ni bypass opcional. El adaptador registra la sesión si falta y rechaza un registry que no coincida. Eventos started/completed/blocked incluyen toolCallId; eliminada emisión duplicada desde callbacks de UI.

Cambio deliberado de permisos: skipConfirmation suprime preguntas, no concede autoridad. Se conserva confianza configurada y aprobación interactiva, ligada mediante snapshot al id/nombre/input exactos antes de hooks. Un hook que cambie una escritura requiere nueva aprobación; en este incremento se bloquea con error explícito. Plan/ask/review/architect mantienen política de solo lectura del runtime. El shell que el antiguo REPL consideraba seguro sigue sujeto a confirmación del runtime; no se añade una excepción permisiva. La política explícita del runtime conserva poder de denegación.

Pruebas de regresión con file tools y disco: no escribir sin consentimiento en ejecución no interactiva, no escribir en plan aun con confianza y no modificar archivo distinto mediante hook. Tres casos fallan contra HEAD anterior y pasan con el cambio. Tests del adaptador aportados por `/root/core_audit`: consentimiento exacto, snapshot, permisos, señal y eventos. Corpus anterior ahora declara confianza explícita en tools utilizadas, en vez de depender de omitir UI. 118 archivos / 2222 pruebas pasan, 15 omitidas, más 27 de arranque REPL. Typecheck/lint/formato y diff-check correctos. Revisor independiente `/root/baseline_review`: APPROVED, sin hallazgos materiales. Logs `runtime-repl-{integration,startup,permissions-before,permissions-after}.log` y `runtime-dispatch-tests.log`. Rollback por revert del incremento.

Límites: no mide capacidad del modelo, ni acredita ejecución completa del CLI headless a partir de estas pruebas de loop. Propagación efectiva de cancelación a procesos sigue E07; veracidad de éxito agregado headless sigue E11. Política MCP/delegación y robustez de patrones bash siguen E04/E05; detector de alias pendiente de siguiente incremento. Sin publicación.
