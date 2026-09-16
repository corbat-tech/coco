# E02 — CI y entrega verificable

Estado: IN_PROGRESS. Baseline de producto: 174fc41; rama `codex/coco-evolution`.

## E02.a — scripts y CI (DONE)

- `test:e2e` usa la configuración principal y descubre `test/e2e`: 4 archivos, 32 tests correctos, exit 0 bajo Node 22/sandbox de E01.
- `test:repl` ejecuta la suite separada: 27 tests correctos, exit 0. Eliminado `poolOptions` obsoleto; desaparece el warning observado en baseline.
- CI añade job REPL independiente. La suite de cobertura conserva e2e y sus exclusiones; no se repite e2e en otro job.
- YAML parseado correctamente con la dependencia `yaml`; `git diff --check` correcto. Ejecución en GitHub pendiente; no se atribuye éxito remoto a validación local.

Revisor `/root/baseline_review`: APPROVED. Scripts mantienen la convención POSIX existente; no se acredita ejecución desde cmd.exe de Windows.

Los tests e2e actuales son herméticos; el smoke instalado y el control de publicación siguen pendientes de E02.b/c. No se ha publicado ni creado un tag.
