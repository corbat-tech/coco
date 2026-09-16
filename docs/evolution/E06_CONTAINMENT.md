# E06 — contención de capacidades incompletas

E06.a DONE: comandos clásicos build/resume dejan de simular ejecución y recuperación. Conservan nombres/opciones, informan indisponibilidad y salen con código 1. No crean proyectos, tareas, resultados de tests ni checkpoints. El REPL /build y /output informa indisponibilidad sin pedir permisos. No se implementa C02 ni se equiparan checkpoints de fase y sesiones REPL.

Reproducción: antes, resume --list devuelve 0 y muestra checkpoints ficticios; test de subprocess falla. Después, 7 pruebas de CLI real (5 variantes y 2 ayudas) y 2 del REPL pasan. Tests de simuladores retirados y sustituidos por comportamiento observable: menos tests no significa menor garantía del comportamiento retirado.

Revisión `/root/baseline_review` pidió retirar además recomendaciones activas en errores, progreso y README generado; corregidas y revalidadas. 7 archivos / 177 tests correctos; typecheck y lint completos exit 0. Revisión final APPROVED. Notas de compatibilidad añadidas a tres guías históricas; documentación de onboarding detallada sigue en E12.

Logs de antes/después y consumidores: `.dev/evolution/e01-baseline/logs/legacy-*.log`. Commit de implementación registrado en Git. Inventario COCO-01: contenido en esta superficie. Resto de E06 (starter y salidas de calidad) pendiente; no autoriza publicar mientras otros P0/P1 sigan abiertos.

## E06.b · DONE · 2026-09-16

Las cuatro demos HTTP usan helper local compartido: escucha 127.0.0.1, puerto validado y log del puerto real, cuerpo máximo 64 KiB contado por bytes, Content-Type JSON, validación de objeto/mensaje/campos de sesión y confirmación. Respuestas 400/413/415/500 controladas y sin errores internos expuestos. Lectura con destroyOnReturn:false conserva socket para enviar 413; desconexión del cliente no deja rechazo sin capturar. README declara alcance local sin autenticación ni aislamiento hosted. RootDir de apps incluye helper compartido; no se añade API pública del paquete.

72 casos sobre los cuatro entrypoints reales con sockets y proveedor simulado, más 37 runtime: 109 correctos. Cuatro typechecks de apps, lint y format globales y de apps correctos. Antes: ocho casos de validación confirmedTools fallan contra handlers HEAD instrumentados solo con export del servidor y binding local para ejecutar la prueba sin exposición; no es evidencia previa del binding. Log `e06b-before-validation.log`. Después `e06b-after.log`, `e06b-types-*.log`. El mirror hermético necesitó restaurar enlaces workspace de apps hacia su paquete local (normalmente creados por pnpm install); sin red externa.

Coordinador implementa; `/root/core_audit` escribe tests; revisión `/root/baseline_review` APPROVED. Sin cambio de proveedor/modelo ni afirmación de capacidad real. C05 auth/ownership permanece condicionado; soporte queued:true preexistente se corrige en E06.c. Sin publicación; rollback por revert.

## E06.c · DONE · 2026-09-16

Callback de escalación de soporte devuelve queued:false, ID vacío y propuesta explícitamente no enviada. README coincide; no hay cola ni envío real. Test captura el callback que el entrypoint instala en el preset: falla antes por queued:true; después 73 tests HTTP correctos, lint/format correctos. Logs `e06c-before.log`, `e06c-after.log`. Implementación y test coordinador; revisión `/root/baseline_review` APPROVED. Sin publicación; rollback por revert.

## E06.d · DONE · 2026-09-16

Iterador COMPLETE requiere evaluación terminada, meetsMinimum, dimensiones completas finitas 0–100, umbrales, pruebas positivas sin fallos y ausencia de críticos para aceptar. Evaluador ausente/error devuelve fallo explícito y conserva trabajo/versiones; finalScore 0 no presenta nota LLM como medición. Success y converged separados. Límite agotado nunca acepta por nota aislada ni guarda una mejora final sin probar.

15 regresiones fallan antes; después COMPLETE 12 archivos / 284 tests correctos, typecheck/lint/format correctos. Tests antiguos mantienen 46 casos con medición explícita independiente del reviewer; un fixture afectado por caché doMock ahora comprueba feedback real hacia improve con dependencias locales. Logs `e06d-before.log`, `e06d-after.log`. Coordinador implementa; `/root/core_audit` nuevas regresiones; `/root/file_fixture_update` fixtures; `/root/baseline_review` APPROVED.

Contención del consumidor: fallbacks/procedencia del evaluador siguen E06.e/E09 y reportes de texto REPL requieren etiquetado. No acredita calidad real de extremo a extremo ni evals con proveedor real. Sin publicación; rollback por revert.

## E06.e · DONE · 2026-09-16

QualityEvaluator rechaza la lectura fallida de fuentes y los rechazos de sus 12 analizadores, en lugar de devolver notas de sustitución (el error de duplicación antes producía 100). Espera todos los análisis iniciados y después propaga el fallo, sin repetirlos. Error indica dimensión, sin causa sensible. Un archivo ilegible no se considera código vacío.

15 casos nuevos: 14 fallan antes, uno conserva paridad. Después quality/tools/iterator: 27 archivos / 496 tests correctos; typecheck/lint/format correctos. Logs `e06e-before.log`, `e06e-after.log`. Coordinador implementa; `/root/core_audit` pruebas; `/root/baseline_review` APPROVED. Disponibilidad interna, aplicabilidad y overrides registry siguen E09; esta contención no acredita medición completa extremo a extremo. Siguiente: presentación REPL de reportes autodeclarados. Sin publicación; rollback por revert.
