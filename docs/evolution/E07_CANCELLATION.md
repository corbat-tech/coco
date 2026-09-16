# E07 — cancelación y coherencia de ejecución

## E07.a · DONE · 2026-09-16

La limpieza deja de descubrir procesos Vitest/Jest globales por nombre. REPL no llama al helper; export obsoleto queda como shim sin efectos. El registro distingue señal enviada de finalización y conserva procesos hasta settlement. La limpieza captura sus propietarios al comenzar, espera salida o tres segundos, cancela el timer si termina antes y escala a SIGKILL si sigue pendiente, incluso con killed:true. No borra altas concurrentes ni considera un error al señalar como prueba de salida. El handler exit también intenta SIGKILL en todos los pendientes.

Nueve regresiones con thenables y timers simulados: siete fallan contra HEAD anterior y dos conservan paridad. Después 4 archivos / 59 tests correctos, REPL separado 27 correctos. Logs `e07a-before.log`, `e07a-focused.log`, `e07a-repl.log`. Coordinador implementa; `/root/core_audit` escribe tests; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos.

Esto verifica propiedad y ciclo de vida del registro, no la terminación real de árboles de procesos. Resolver killAllSubprocesses tras SIGKILL significa intento realizado; la entrada permanece hasta finalizar. Shell, procesos hijos, señales de proveedores, cuotas y streams incompletos siguen pendientes. Sin publicación; rollback por revert.

## E07.b · DONE · 2026-09-16

bash_exec recibe AbortSignal del host, rechaza antes de lanzar si ya está cancelado y lo transmite a Execa. Registra el subprocess y configura escalada tras tres segundos. Con reject:false, cancelación, timeout, señal o código de salida ausente ya no se convierten en exitCode:0. Conserva códigos numéricos de fallo. Libera listeners propios stdout/stderr (preserva ajenos) y heartbeat al terminar o rechazar.

SDK local Execa 9.6.1; contraste con [documentación oficial de terminación de esa versión](https://github.com/sindresorhus/execa/blob/v9.6.1/docs/termination.md), consultada 2026-09-16: cancelSignal envía SIGTERM y forceKillAfterDelay controla escalada. Diez regresiones simuladas fallan antes; después 4 archivos / 60 tests correctos, incluida cancelación real tras READY de un shell exec Node con handle propio y salida confirmada. Integración Unix, omitida en Windows. Logs `e07b-before.log`, `e07b-focused.log`. Coordinador implementa; `/root/core_audit` tests; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos.

Pendientes explícitos: árboles/descendientes y background, límites de acumulación de stdout/stderr, transporte LLM/MCP y streams incompletos. Cancelar no revierte efectos anteriores del comando. Sin publicación; rollback por revert.

## E07.c · DONE · 2026-09-16

withRetry acepta señal opcional del host, verifica cancelación antes/después de la petición y antes de reintentar. La espera entre intentos libera timer/listener al cancelar o finalizar y preserva el motivo de aborto. AbortError no se considera recuperable aunque contenga un texto como 429. Mantiene las llamadas anteriores sin señal. No puede interrumpir una función que ignore la señal: el cableado efectivo de SDK sigue en E07.d.

Siete casos nuevos sobre preabort, cancelación durante espera/petición, éxito tardío, AbortError, limpieza de listeners propios y compatibilidad anterior. 2 archivos / 31 tests correctos (`e07c-focused.log`). Coordinador implementa; `/root/core_audit` tests; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos. Sin llamadas pagadas ni publicación; rollback por revert.

## E07.d · DONE · 2026-09-16

Ocho rutas OpenAI (Chat Completions/Responses × chat/tools/stream/stream-tools) transmiten signal, timeout por llamada y maxRetries:0 como opciones de transporte, separadas del payload. Coco conserva su retry configurable, ahora cancelable, sin multiplicarlo por retries internos del SDK. Preabort no inicia petición; abortos mantienen su causa. Watchdogs usan timeout por llamada. Streams comprueban aborto/timeout antes de cada emisión, además de chunk/EOF, sin convertir cierre silencioso por cancelación en done.

SDK instalado OpenAI 6.34.0, manifest conserva ^6.27.0 y lock sin cambios. [Referencia oficial TypeScript](https://developers.openai.com/api/reference/typescript), consultada 2026-09-16, secciones Cancellation/Timeouts/Retries: signal cancela petición y lectura del body; timeout admite override por petición; maxRetries:0 desactiva reintentos SDK (dos por defecto). Contrato contrastado con tipos/código SDK local. No se añaden ni retiran modelos, ni se presupone que la documentación de OpenAI valide APIs de otros proveedores.

Revisión independiente detectó cancelación entre varios yields del mismo evento y watchdog vencido antes de done; se añadieron guardias por emisión y regresiones. SDK real comprobado contra HTTP loopback: cuatro casos (dos APIs, espera de headers o body SSE) observan desconexión sin reintento ni done, sin peticiones externas ni consumo pagado. Fixtures de payload previos conservados con segundo argumento explícito. Streams truncados, deduplicación, otros proveedores y adaptadores siguen pendientes.

Validación final: 23 archivos / 646 tests correctos, incluidos 38 casos nuevos de contrato y las cuatro integraciones HTTP locales; typecheck, lint y format correctos. Logs `e07d-providers.log`, `e07d-local-sdk.log`. Coordinador implementa e integración local; `/root/core_audit` contratos; `/root/file_fixture_update` fixtures; `/root/baseline_review` APPROVED tras corregir hallazgo. Sin publicación; rollback por revert.
