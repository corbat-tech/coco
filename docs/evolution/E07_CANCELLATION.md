# E07 — cancelación y coherencia de ejecución

## E07.a · DONE · 2026-09-16

La limpieza deja de descubrir procesos Vitest/Jest globales por nombre. REPL no llama al helper; export obsoleto queda como shim sin efectos. El registro distingue señal enviada de finalización y conserva procesos hasta settlement. La limpieza captura sus propietarios al comenzar, espera salida o tres segundos, cancela el timer si termina antes y escala a SIGKILL si sigue pendiente, incluso con killed:true. No borra altas concurrentes ni considera un error al señalar como prueba de salida. El handler exit también intenta SIGKILL en todos los pendientes.

Nueve regresiones con thenables y timers simulados: siete fallan contra HEAD anterior y dos conservan paridad. Después 4 archivos / 59 tests correctos, REPL separado 27 correctos. Logs `e07a-before.log`, `e07a-focused.log`, `e07a-repl.log`. Coordinador implementa; `/root/core_audit` escribe tests; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos.

Esto verifica propiedad y ciclo de vida del registro, no la terminación real de árboles de procesos. Resolver killAllSubprocesses tras SIGKILL significa intento realizado; la entrada permanece hasta finalizar. Shell, procesos hijos, señales de proveedores, cuotas y streams incompletos siguen pendientes. Sin publicación; rollback por revert.
