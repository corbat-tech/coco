# E06 — contención de capacidades incompletas

E06.a DONE: comandos clásicos build/resume dejan de simular ejecución y recuperación. Conservan nombres/opciones, informan indisponibilidad y salen con código 1. No crean proyectos, tareas, resultados de tests ni checkpoints. El REPL /build y /output informa indisponibilidad sin pedir permisos. No se implementa C02 ni se equiparan checkpoints de fase y sesiones REPL.

Reproducción: antes, resume --list devuelve 0 y muestra checkpoints ficticios; test de subprocess falla. Después, 7 pruebas de CLI real (5 variantes y 2 ayudas) y 2 del REPL pasan. Tests de simuladores retirados y sustituidos por comportamiento observable: menos tests no significa menor garantía del comportamiento retirado.

Revisión `/root/baseline_review` pidió retirar además recomendaciones activas en errores, progreso y README generado; corregidas y revalidadas. 7 archivos / 177 tests correctos; typecheck y lint completos exit 0. Revisión final APPROVED. Notas de compatibilidad añadidas a tres guías históricas; documentación de onboarding detallada sigue en E12.

Logs de antes/después y consumidores: `.dev/evolution/e01-baseline/logs/legacy-*.log`. Commit de implementación registrado en Git. Inventario COCO-01: contenido en esta superficie. Resto de E06 (starter y salidas de calidad) pendiente; no autoriza publicar mientras otros P0/P1 sigan abiertos.
