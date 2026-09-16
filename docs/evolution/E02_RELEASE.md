# E02 — CI y entrega verificable

Estado: IN_PROGRESS. Baseline de producto: 174fc41; rama `codex/coco-evolution`.

## E02.a — scripts y CI (DONE)

- `test:e2e` usa la configuración principal y descubre `test/e2e`: 4 archivos, 32 tests correctos, exit 0 bajo Node 22/sandbox de E01.
- `test:repl` ejecuta la suite separada: 27 tests correctos, exit 0. Eliminado `poolOptions` obsoleto; desaparece el warning observado en baseline.
- CI añade job REPL independiente. La suite de cobertura conserva e2e y sus exclusiones; no se repite e2e en otro job.
- YAML parseado correctamente con la dependencia `yaml`; `git diff --check` correcto. Ejecución en GitHub pendiente; no se atribuye éxito remoto a validación local.

Revisor `/root/baseline_review`: APPROVED. Scripts mantienen la convención POSIX existente; no se acredita ejecución desde cmd.exe de Windows.

Los tests e2e actuales son herméticos; el smoke instalado y el control de publicación siguen pendientes de E02.b/c. No se ha publicado ni creado un tag.

## E02.b — gate de procesos (DONE)

`check:release` ejecuta typecheck, lint, formato, suite completa, REPL separado y build mediante entrypoints JS locales y el mismo Node. No usa binarios globales como fallback. Nueve tests de procesos reales verifican éxito, fallo por etapa, parada inmediata, dependencia ausente y señal. Tests focalizados y gate completo exit 0. Revisor `/root/baseline_review`: APPROVED; hashes coincidentes con copia probada. Logs locales `release-gate-tests.log` y `release-gate.log` en evidencia E01.

Cobertura se midió en E01; conectar su umbral al gate final, smoke de artefacto y canales sigue pendiente de E02.c. No confundir el mensaje de checks correctos con aprobación para publicar superficies con P0/P1 abiertos.

## E02.c.1 — paquete instalado (DONE)

Nuevo `scripts/smoke-package.mjs <consumer> <expected-version>` verifica CLI --version/--help, exports públicos y un turno de runtime con provider guionizado y read_file real. Exige instalación local y versión exacta, comprueba resultado de tool y archivo intacto.

Tarball producido con npm pack --ignore-scripts a partir del build probado; SHA-256 `280c1c073f26db018b55efa6fdcf647597604c2fb55584855a9935ee8e9c878d`. Instalación limpia de 244 paquetes con npm configs vacías, sin credenciales heredadas ni lifecycle scripts. Smoke PASS; versiones incorrectas y paquete ausente fallan. Revisor `/root/baseline_review`: APPROVED sobre SHA-256 del script `09ba2428a977d860501e3fb0bfe1ca06b78405320327501e0360a67a558113eb`. No se ha publicado al registro.

Primer smoke falló con ruta /var/folders: la política de archivos la clasifica como sistema mientras su alias canónico /private/var/folders permite acceso. Se preserva `package-smoke-initial.log`, y se usa realpath para el consumer. E04 debe revisar coherencia de alias; esto no resuelve el defecto de producto. Logs locales en evidencia E01.
