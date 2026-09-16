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
