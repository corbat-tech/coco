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
