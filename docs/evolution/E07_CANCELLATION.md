# E07 — cancelación y coherencia de ejecución

## E07.a · DONE · 2026-09-16

La limpieza deja de descubrir procesos Vitest/Jest globales por nombre. REPL no llama al helper; export obsoleto queda como shim sin efectos. El registro distingue señal enviada de finalización y conserva procesos hasta settlement. La limpieza captura sus propietarios al comenzar, espera salida o tres segundos, cancela el timer si termina antes y escala a SIGKILL si sigue pendiente, incluso con killed:true. No borra altas concurrentes ni considera un error al señalar como prueba de salida. El handler exit también intenta SIGKILL en todos los pendientes.

Nueve regresiones con thenables y timers simulados: siete fallan contra HEAD anterior y dos conservan paridad. Después 4 archivos / 59 tests correctos, REPL separado 27 correctos. Logs `e07a-before.log`, `e07a-focused.log`, `e07a-repl.log`. Coordinador implementa; `/root/core_audit` escribe tests; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos.

Esto verifica propiedad y ciclo de vida del registro, no la terminación real de árboles de procesos. Resolver killAllSubprocesses tras SIGKILL significa intento realizado; la entrada permanece hasta finalizar. Shell, procesos hijos, señales de proveedores, cuotas y streams incompletos siguen pendientes. Sin publicación; rollback por revert.

## E07.b · DONE · 2026-09-16

bash_exec recibe AbortSignal del host, rechaza antes de lanzar si ya está cancelado y lo transmite a Execa. Registra el subprocess y configura escalada tras tres segundos. Con reject:false, cancelación, timeout, señal o código de salida ausente ya no se convierten en exitCode:0. Conserva códigos numéricos de fallo. Libera listeners propios stdout/stderr (preserva ajenos) y heartbeat al terminar o rechazar.

SDK local Execa 9.6.1; contraste con [documentación oficial de terminación de esa versión](https://github.com/sindresorhus/execa/blob/v9.6.1/docs/termination.md), consultada 2026-09-16: cancelSignal envía SIGTERM y forceKillAfterDelay controla escalada. Diez regresiones simuladas fallan antes; después 4 archivos / 60 tests correctos, incluida cancelación real tras READY de un shell exec Node con handle propio y salida confirmada. Integración Unix, omitida en Windows. Logs `e07b-before.log`, `e07b-focused.log`. Coordinador implementa; `/root/core_audit` tests; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos.

Pendientes explícitos: árboles/descendientes y background, límites de acumulación de stdout/stderr, transporte LLM/MCP y streams incompletos. Cancelar no revierte efectos anteriores del comando. Sin publicación; rollback por revert.
