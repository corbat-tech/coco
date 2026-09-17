# next.6 — procesos propiedad de sesión y recuperación conservadora

Estado: implementación, revisión independiente y pruebas focalizadas realizadas; puerta completa/publicación pendientes.

## Cambios

- Background habilitado por el host del REPL, con un propietario por sesión/proyecto. Sin propietario, no se ejecuta. Dos trabajos activos; 30 minutos; 16 MiB por canal; consulta, estado, lectura paginada y cancelación. Se conservan como máximo dos resultados terminados y los dos trabajos activos. La página ofrece base64 para reconstruir bytes Unicode sin pérdida.
- El cierre normal, excepcional y por señal limpia los recursos del REPL. Limpiar/reanudar una conversación cierra los trabajos de la sesión anterior. La finalización del turno que lanzó el trabajo no cancela por sí misma un proceso aceptado.
- `/resume` comprueba proyecto e identidad, no importa consentimiento ni configuración desde el historial y registra como desconocidos los resultados de llamadas interrumpidas: no repite sus efectos.
- `/rewind` usa checkpoints persistidos con estado antes/después y hashes comprobados. Comprueba todos los conflictos conocidos antes de escribir; rechaza snapshots antiguos sin evidencia, rutas externas/internas, symlinks, hardlinks, archivos binarios y contenido cambiado por terceros. No modifica el índice Git.

## Límites explícitos

POSIX: propiedad del grupo de procesos, sin promesa de controlar procesos que escapen deliberadamente del grupo o efectos remotos. Background Windows permanece deshabilitado. No persiste procesos a través del reinicio del host.

Captura reversible limitada a `write_file`, `edit_file` y `delete_file`, archivos regulares UTF-8 de hasta 1 MiB y directorios padre existentes. No se promete revertir shell, directorios, red ni efectos de otras herramientas. La restauración de varios archivos no es una transacción del sistema de archivos: cambios concurrentes o errores pueden producir un resultado parcial, informado explícitamente.

## Evidencia

- 91 pruebas focalizadas y typecheck: PASS en mirror aislado.
- Incluye procesos descendientes resistentes a TERM, aislamiento entre sesiones, límites de salida/retención, restauración real y preservación byte a byte del índice Git y archivos ajenos.
- Revisión independiente corrigió vida útil de la señal de lanzamiento, captura cuadrática de salida, Unicode, escrituras sobre rutas equivocadas, snapshots corruptos y limpieza excepcional del host.

## Cierre

- [ ] Integración REPL con cierre excepcional.
- [ ] Puerta completa del commit exacto y clean install.
- [ ] Publicación OIDC, integridad npm/canal y assets GitHub.
