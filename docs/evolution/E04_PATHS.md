# E04 · Rutas y operaciones seguras

## E04.a · DONE · 2026-09-16

Nuevo resolver común con raíz explícita, pertenencia por path.relative, NUL rechazado antes de normalizar, destino canónico y ancestro existente para archivos nuevos. Rechaza enlaces colgantes. Autoriza nombre y destino según proyecto o concesión read/write; conserva excepciones exactas de configuración home. Delete/no-follow conserva la entrada del enlace en vez de devolver su target para unlink/rename.

Diez pruebas de filesystem real con raíz temporal explícita verifican traversal/sibling/exterior, enlaces existentes y padres, destinos profundos aún inexistentes, NUL, enlaces internos, alias de raíz, semántica de hoja y grant read. No hacen mutaciones de file tools; comprueban que resolver no modifica sentinels ni crea destinos. Log `path-policy-helper.log`. Typecheck/lint correctos. Tests aportados por `/root/core_audit`; revisor independiente `/root/baseline_review`: APPROVED, sin defectos materiales para el incremento preparatorio.

El helper todavía no sustituye la validación antigua de file.ts. E04.b debe integrarlo en cada operación y fijar canónicamente las concesiones al autorizarlas/cargarlas; no presentar autorizaciones léxicas antiguas como seguras frente a retargeting. COMPLETE necesita su subpaso de prevalidación de todo el batch antes de mutar. No es un sandbox del SO ni elimina carreras de filesystem entre validación y operación. Sin publicación; rollback por revert del incremento.
