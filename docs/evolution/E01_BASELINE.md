# E01.a — baseline antes de implementar

Fecha: 2026-09-16. Código: `174fc4128bc190fe0cb0b581d2153b805c49f4af` (2.41.0).

## Entorno y alcance

macOS arm64, Node 22.23.2, pnpm 10.0.0, Vitest instalado 4.1.4. Node descargado de nodejs.org y contrastado con SHASUMS256: `61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6`. Copia de `git archive HEAD`; dependencias instaladas clonadas mediante APFS, sin reinstalarlas. No se acredita aún reproducibilidad mediante instalación limpia del lockfile: corresponde al gate E02.

Procesos con entorno allowlist sin tokens ni proxy/SSH agent heredados; sandbox-exec restringe red externa, escrituras a temporales y lecturas de directorios de credenciales conocidos. HOME no se redefine. Este perfil de pruebas no se incorpora al producto ni acredita un sandbox de Coco. Algunas bibliotecas siguen resolviendo el homedir real: se bloquea su acceso y se registra el resultado. No se ejecutan providers reales ni publicaciones.

Logs completos, perfil, runner y resultados locales: `.dev/evolution/e01-baseline/` (ignorados por Git). Checksums/resultados en [E01_RESULTS.json](E01_RESULTS.json). Los logs locales no estarán disponibles en otro checkout sin copiarlos. La evidencia resumida de fallos se conserva aquí.

Lockfile SHA-256: `01e27d8b3d6bb52295b3850da6bfbe5dab2770f9d1a65be147080b6559f986f1`.

## Resultados

| Comando | Resultado |
| --- | --- |
| pnpm typecheck | PASS |
| pnpm lint | PASS |
| pnpm format | PASS |
| pnpm test --maxWorkers=4 | FAIL: 291 archivos pasan, 1 falla; 6573 tests pasan, 4 fallan, 15 omitidos |
| pnpm exec vitest run --config vitest.repl.config.ts | PASS: 27 tests; warning por poolOptions retirado en Vitest 4 |
| pnpm test:e2e | FAIL: falta vitest.e2e.config.ts |
| pnpm build | PASS, incluidos tipos |

Los cuatro fallos son de `src/mcp/config-loader.test.ts`, grupo `loadMCPServersFromCOCOConfig`: casos sin configuración, servidores stdio, servidores HTTP y servidores inválidos. Todos intentan leer `/Users/vmart/.coco/config.json` y reciben EPERM bajo el perfil. Esto demuestra dependencia del entorno del usuario en esos tests; no demuestra cuatro errores del loader en uso normal. Corregir aislamiento del test y repetir sin permitir leer configuración personal.

Los tres archivos `test/e2e/*.test.ts` sí entran en la suite principal: lo roto es el comando dedicado. Son integración con mocks, no resolución autónoma con un modelo ni smoke del paquete instalado.

Cobertura aún no medida. Pisos configurados: líneas 66, funciones 72, ramas 57, sentencias 65; exclusiones amplias (auth, swarm, REPL y otras). Objetivo CLAUDE 80% sigue pendiente. Apps, extensión, gate de release y corpus real se validarán en sus subpasos; este baseline no acredita una release lista.

## Próximos subpasos

- E01.a.1: aislar configuración global en tests MCP; reproducir los cuatro fallos antes y comprobar después.
- E01.b: corpus hermético de tareas sobre REPL y herramientas reales, con verificadores de archivos; distinguirlo de capacidad con modelo real, aún pendiente.
- E02.a: reparar scripts de suites, ejecutar REPL en CI y retirar opción obsoleta comprobada.

E01.a DONE (medición y registro, no baseline verde). Revisión independiente: `/root/baseline_review`, aprobada tras comprobar logs, cifras y hashes. E01 global sigue IN_PROGRESS; inventario P0/P1 y corpus pendientes. Ningún fallo previo se silencia para declarar baseline verde.

## E01.a.1 — aislamiento de configuración MCP

DONE. `src/mcp/config-loader.test.ts` sustituye solo la ruta de configuración global por un archivo temporal por caso, conservando loader y filesystem reales. Antes: cuatro EPERM; después: 14/14 tests focalizados. Formato y lint correctos. Revisor independiente `/root/baseline_review`: APPROVED sobre SHA-256 `bb423d94cdda4fc2b8624f11e9951c210270a12f895a8f1a7cc5adc8a15076fc`.

Suite completa con cobertura repetida tras el cambio bajo el mismo perfil: exit 0; 292 archivos, 6577 tests correctos y 15 omitidos. Cobertura con exclusiones actuales: sentencias 68,35%, ramas 60,19%, funciones 74,75%, líneas 68,97%. Supera pisos actuales, no alcanza el objetivo 80%. Logs `mcp-isolation.log` y `coverage-after-isolation.log` en el directorio local de evidencia. El código de producto no cambia. El comando e2e dedicado sigue pendiente de E02.a.

## E01.b — corpus inicial

Tres tareas herméticas en `test/e2e/repl-tasks.test.ts`: bug aritmético con verificador que falla antes, nueva función con ejemplos de aceptación, y edición inválida seguida de recuperación. Se ejecutan el loop REPL, registry y file tools reales en disco temporal; solo el proveedor está guionizado. Node ejecuta verificadores independientes y se comprueba conservación de un archivo del usuario.

Los casos usan `skipConfirmation: true`: no evalúan permisos. El sentinel acredita conservación de ese archivo concreto, no ausencia universal de escrituras externas.

Esto prueba integración y efectos, NO la capacidad de un modelo de descubrir una solución. Evaluación real pendiente del proveedor/presupuesto; esa limitación no bloquea reparar CI pero sí atribuir mejoras de éxito de tareas a E13 o cerrar E15. No hay consumo de API.

## Inventario inicial P0/P1 por superficie

El código de producto permanece idéntico al snapshot de auditoría; solo cambia aislamiento de tests. Se conserva la evidencia estática original, sin presentar estos riesgos como nuevos bugs reproducidos dinámicamente. Hasta corregir o contener cada fila, bloquear la publicación de la superficie afectada. Cada paso revalidará su reproducción antes de modificar.

| Hallazgo | Superficie | Estado / destino |
| --- | --- | --- |
| COCO-01 P0 | CLI build/resume clásico | Abierto; E06 contención, C02 funcionalidad opcional |
| COCO-02 P0 | File tools y COMPLETE | Abierto; E03/E04 |
| COCO-03 P1 | Shell y undo | Abierto; E04 |
| COCO-04 P1 | MCP | Abierto; E05 |
| COCO-05 P1 | Ejecución/cancelación | Abierto; E07 |
| COCO-06 P1 | Aceptación calidad | Abierto; E06/E09 |
| COCO-07 P1 | Última mejora sin validar | Abierto; E09 |
| COCO-08 P1 | Recuperación/fases | Abierto; E10 |
| COCO-09 P1 | Medición/política calidad | Abierto; E09 |
| COCO-10 P1 | Dependencias entre sprints | Abierto; contener si expuesto, C02 condicionado |
| COCO-11 P1 | Delegación | Abierto; E05 |
| COCO-16 P1 | CI/cobertura | E01 mide; E02/E14 pendientes |
| COCO-17 P1 | npm/VSIX/GitHub release | Abierto; E02, ningún tag de publicación aún |
| COCO-21 P1 | Starter HTTP | Abierto; E06 local, C05 público condicionado |

E01.b DONE (corpus hermético): 3/3 tests pasan. Revisor `/root/baseline_review`: APPROVED tras reforzar finalización/error y número de calls. SHA-256 probado/revisado: `f4cdfa49b2c6622ac4e874774b8b05d2adcfcd088b4a96f999e2d19bc9c25dfa`. E01 infraestructura completada; baseline de modelo real sigue pendiente y es dependencia explícita de las afirmaciones de E13/E15.
