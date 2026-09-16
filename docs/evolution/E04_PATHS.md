# E04 · Rutas y operaciones seguras

## E04.a · DONE · 2026-09-16

Nuevo resolver común con raíz explícita, pertenencia por path.relative, NUL rechazado antes de normalizar, destino canónico y ancestro existente para archivos nuevos. Rechaza enlaces colgantes. Autoriza nombre y destino según proyecto o concesión read/write; conserva excepciones exactas de configuración home. Delete/no-follow conserva la entrada del enlace en vez de devolver su target para unlink/rename.

Diez pruebas de filesystem real con raíz temporal explícita verifican traversal/sibling/exterior, enlaces existentes y padres, destinos profundos aún inexistentes, NUL, enlaces internos, alias de raíz, semántica de hoja y grant read. No hacen mutaciones de file tools; comprueban que resolver no modifica sentinels ni crea destinos. Log `path-policy-helper.log`. Typecheck/lint correctos. Tests aportados por `/root/core_audit`; revisor independiente `/root/baseline_review`: APPROVED, sin defectos materiales para el incremento preparatorio.

El helper todavía no sustituye la validación antigua de file.ts. E04.b debe integrarlo en cada operación y fijar canónicamente las concesiones al autorizarlas/cargarlas; no presentar autorizaciones léxicas antiguas como seguras frente a retargeting. COMPLETE necesita su subpaso de prevalidación de todo el batch antes de mutar. No es un sandbox del SO ni elimina carreras de filesystem entre validación y operación. Sin publicación; rollback por revert del incremento.

## E04.b · DONE · 2026-09-16

Concesiones fijadas al destino canónico antes de mostrar confirmación; el setter/persistencia rechaza cambios respecto al destino que vio el usuario. Entradas cargadas con alias antiguos sin destino registrado requieren reautorizar; entradas inaccesibles no conceden acceso. El resolver rechaza una raíz concedida posteriormente sustituida por symlink y permite aliases que siguen resolviendo dentro del destino autorizado, conservando restricciones de la entrada operativa al borrar/renombrar.

Cambio de proyecto limpia concesiones de sesión; clear también limpia el proyecto de persistencia. getAllowedPaths copia las entradas para no exponer permisos internos mutables. Una aprobación explícita permite elevar read a write sin duplicados. Se conserva API síncrona de alta, con comprobaciones de metadata del directorio; no se añade servicio ni framework.

Diez pruebas reales de grants más consumidores: 6 archivos / 84 tests pasan. Seis regresiones seleccionadas de APIs existentes fallan contra HEAD anterior (pin, retarget, cambio de proyecto, mutación de copia, upgrade y persistencia tras clear). Logs `path-grants-{before,after}.log`; typecheck/lint/diff-check correctos. Tests de grants por `/root/core_audit`; coordinator añade caso del intervalo de confirmación y pruebas de diálogo. Revisor independiente `/root/baseline_review`: APPROVED tras corregir el hallazgo registrado debajo.

E04.c todavía debe sustituir los accesos de file.ts y demostrar efectos reales negativos; este incremento no afirma que todas las herramientas estén ya protegidas. Sin publicación, rollback por revert.

Hallazgo independiente E04.b: CHANGES_REQUESTED por escape estático de doble enlace en delete/no-follow (padre sale del scope, hoja vuelve al target permitido). Corregido exigiendo pertenencia de la ruta operativa en todas las ramas de autorización, no solo del destino final. Dos regresiones proyecto/grant fallan antes de la corrección y pasan después; incluyen intento condicionado de unlink y preservan entrada y target externos. Log `path-grants-double-link-before.log`; revisión de corrección `/root/baseline_review`: APPROVED, sin objeciones materiales pendientes.

## E04.c · DONE · 2026-09-16

Read/write/edit/delete/copy/move usan el resolver común antes de cualquier acceso que pueda producir efectos. Copy/move validan ambos extremos antes de mkdir; delete y rename conservan la hoja del enlace. El export resolvePathSecurely de file.ts se conserva mediante reexport. Retirada la antigua política duplicada basada parcialmente en HOME.

Regresiones con efectos reales: 13 casos (9 fallan antes, 4 de paridad ya pasaban), con sentinels, ausencia de directorios/archivos externos y conservación de targets al borrar/mover enlaces. Incluye escape de doble enlace cuyo destino vuelve al proyecto. Con corpus REPL, sugerencias y políticas: 6 archivos / 133 pruebas pasan. Typecheck/lint correctos; logs `file-scope-{before,after,consumers}.log` y `e04c-file-fixture.log`.

`/root/core_audit` aporta tests reales, `/root/file_fixture_update` adapta únicamente las rutas del filesystem simulado a raíz /test sin conceder accesos universales. Coordinador implementa, refuerza doble enlace y corrige restauración de HOME preexistente en tests. Revisión independiente `/root/baseline_review`: APPROVED, sin hallazgos materiales.

Enumeración (glob/list_dir/tree/file_exists), COMPLETE, shell y undo aún pendientes; no afirmar que COCO-02 está totalmente cerrado. No se eliminan carreras contra procesos externos no confiables. Sin publicación, rollback por revert.
