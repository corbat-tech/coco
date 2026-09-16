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

## E03.e · DONE · 2026-09-16

El test de frontera usa el checker de TypeScript ya instalado para resolver el símbolo ToolRegistry.execute; detecta acceso mediante alias, imports renombrados, parámetros tipados, acceso indexado literal y extracción/desestructuración del método. Distingue execute de otros objetos y texto sin código. No es un sandbox ni detecta evasiones dinámicas deliberadas mediante any/eval.

Cuatro pruebas pasan en ~3,5 s. La prueba contra el antiguo ParallelToolExecutor comprueba los tres accesos `registry.execute` que la búsqueda textual omitía. Lint y diff-check correctos; revisor `/root/baseline_review`: APPROVED. Logs `runtime-boundary-detector{,-before}.log`. Rollback por revert; sin cambios de producción ni publicación.

Observación de revisión: E03 aún no puede cerrarse. El adaptador REPL conservaba confirmaciones adicionales (p. ej. copy_file) que la política runtime no exigía. E03.f debe llevar esa decisión a la política común y comprobar la matriz por entrada. Autoridad delegada sigue abierta en E05.

## E03.f · DONE · 2026-09-16

La política común exige consentimiento para copiar/mover, git pull, instalación/scripts, HTTP, entorno y cambios de permisos, además de operaciones destructivas. Bash en background también se clasifica destructivo. get_env es sensible a secretos y HTTP es red; no quedan sujetos a clasificación accidental por categoría. REPL consulta esa política para preguntar y el adaptador solo transmite consentimiento exacto; se elimina su regla adicional de confirmación.

Matriz de 14 herramientas × 6 modos × 2 estados de consentimiento, comparando API runtime, ejecutor compartido y adaptador REPL: 168 casos, 504 ejecuciones con efectos en memoria verificados. No acredita herencia de autoridad padre/hijo ni modelo real. Suites de consumidores: 24 archivos / 289 pruebas pasan. Typecheck/lint/diff-check correctos. Matriz: 168 casos pasan; fallaba contra el commit anterior. Logs `runtime-confirmation-parity-{before,after,consumers}.log`. Revisor `/root/baseline_review`: APPROVED, sin hallazgos materiales. Rollback por revert, sin publicación.

## Cierre E03

DONE como consolidación de la frontera compartida, confirmado por revisión independiente. La matriz acredita API runtime, ejecutor compartido y adaptador REPL usado por headless; no finge acreditar concesiones reales entre padre e hijo (E05) ni cancelación efectiva de procesos (E07). E04 puede usar la frontera consolidada. La auditoría final aún no se ha ejecutado.
