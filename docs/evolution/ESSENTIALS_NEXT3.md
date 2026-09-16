# Coco next.3: pendientes imprescindibles

**Estado final:2.42.0-next.3 publicada y verificada en npm next.** Latest2.41.0 intacto; desarrollo de este bloque cerrado.

Fecha:2026-09-17. Solicitud: seleccionar los siguientes arreglos imprescindibles, implementarlos y publicar; aplazar extras. Base publicada2.42.0-next.2. Destino2.42.0-next.3 en npm next; latest2.41.0 intacto. Sin migración, modelos nuevos ni ampliación del producto.

## Alcance y aceptación

1. **Shell: memoria y procesos.** Limitar stdout/stderr durante lectura (también acumulación interna de execa y salida reenviada), sin esperar a truncar al final. POSIX conserva ownership del grupo de procesos y lo cierra ante cancelación/timeout/finalización, con TERM/KILL y espera real. Background sin propietario queda explícitamente indisponible. Windows conserva su límite documentado de proceso directo; no se promete sandbox, rollback o terminación remota.
2. **Cancelación de coordinación/sprints expuestos.** Aplicar deadline configurado y señal hasta executor/revisor/tests. No iniciar tareas tras abort ni devolver éxito tardío; no convertir cancelación en fallback de calidad. Drenar trabajo ya iniciado. /build-app sí expone sprint-runner: no confundir con build clásico deshabilitado.
3. **CI.** Mantener íntegro detector semántico de fronteras de tools y sus aserciones; dar presupuesto local de60s a la prueba de proyecto completo que superó30s en runners compartidos. No bajar umbrales, desactivar tests ni relajar detector.

## Flujo de trabajo

Por incremento: implementación → pruebas significativas en copia hermética → revisión por agente distinto → corregir → commit → registrar evidencia. Tests nunca en checkout personal. Gate final pnpm check:release; paquete instalado desde tarball; revisión independiente. Tag nuevo, Actions, publicación next y comparación integridad del artefacto exacto instalado desde registro. Si existe bloqueo externo, registrarlo sin declarar despliegue.

## Progreso

- [x] Shell: captura y reenvío acotados a1MiB por stream; execa sin buffering; grupo POSIX propio con TERM/KILL, espera de cierre y registro compartido; background indisponible. 60 tests PASS +typecheck, incluidos3 procesos reales (cancelación, descendiente resistente al terminar shell, proceso ajeno intacto). Revisión independiente padre aprobada; implementación core_audit. No garantía sobre procesos que abandonen deliberadamente el grupo o efectos remotos.
- [x] Coordinador/sprint: señal y deadline total opcional, propagación a agentes/revisores/tests, drenaje de batch iniciado y rechazo de éxito tardío. /build-app posee listeners temporales de SIGINT/SIGTERM y los restaura. 58 tests PASS +typecheck, revisión independiente codex_terminal_fix aprobada. run_tests acredita hijo directo; descendientes y entrevista inicial no ampliados.
- [x] Presupuesto de prueba de arquitectura:60s solo para resolución de símbolos del proyecto; detector/fixtures/aserciones intactos. Pruebas aisladas4 PASS (resolución2.94s), revisión independiente del padre aprobada. Global30s y cobertura sin cambios.
- [x] Revisión independiente de incrementos; guardas conservan contratos y límites explícitos.
- [x] Gate completo:362 archivos,7932 pruebas PASS/15 skip +27 REPL; tipos/lint/formato/build PASS. Cobertura70.63% statements/63.05% branches/76.08% functions/71.28% lines, pisos existentes intactos. Tarball26 archivos, instalación limpia sin scripts y smoke CLI/exports/archivo real PASS (provider fixture).
- [x] Publicación next.3 verificada:integridad exacta, next=2.42.0-next.3/latest=2.41.0; instalación limpia desde registro y smoke PASS. GitHub prerelease creada y handoff actualizado.

## Pospuesto

E08 fidelidad completa de schemas/API/modelos; E09 mediciones de calidad disponibles/aplicables (calculate_quality continúa indisponible); E10 recuperación/rewind; E11 headless/VSIX; E12 UX; E13 contexto/prompts y comparativas con modelos reales; E14 deuda y objetivo80% de cobertura; E15 auditoría integral con contexto limpio. Cuotas completas de frames MCP, callbacks onboarding y otras superficies de proceso requieren su propio alcance; no se anuncian resueltas aquí. Estos pendientes tienen valor, pero no justifican ampliar esta entrega.


## Evidencia del candidato

Commits827bb01 (CI),45f2934 (shell),9dedfd6 (coordinación). Candidato local2.42.0-next.3 conservado en `.dev/evolution/candidate-2.42.0-next.3/`. SHA256 `5873acc3051086f1b3d619e2f67ae6a254b4f3ed4663648924d591337c85535d`; integridad `sha512-3NIvURFgtnlQAudOargTwGArz8VLW2ASgj6YimfQm8PR8bYvtJPEn0PtkzeuGBzOED60abBOAiQqffmk241NHQ==`. CI construirá su artefacto y exigirá su integridad, sin asumir igualdad binaria con el local. Logs en `.dev/evolution/e01-baseline/logs/next3-*` ignorados por Git.

Publicación pendiente en este punto; no afirmar deploy por haber creado candidato. Confirmado secreto GitHub NPM_TOKEN actualizado2026-09-16T22:01:15Z (solo metadata inspeccionada); validez debe acreditarse al publicar.

Revisión independiente del tarball por codex_terminal_fix: APROBADA para next; inventario/hashes/tamaños coincidentes,26 archivos regulares permitidos, metadata correcta y sin coincidencias en patrones de secretos de alta señal. No auditoría exhaustiva de seguridad ni evaluación de proveedores reales.


## Resultado CI y autorización npm

Candidato commit `d0f8531`, tag `v2.42.0-next.3` subidos. [Actions35157287019](https://github.com/corbat-tech/coco/actions/runs/35157287019) superó instalación, gate completo (incluida arquitectura), pack y smoke. El secreto actualizado autenticó correctamente; publish falló con EOTP (doble factor), no E401. Esto acredita reparación de las pruebas y autenticación, pero no publicación automática.

Artefacto CI descargado como `npm-candidate-1` a `.dev/evolution/ci-candidate-2.42.0-next.3/`. SHA256/integridad coinciden exactamente con el candidato local revisado arriba. Registro consultado: next.3 todavía E404. Publicación local interactiva del mismo tarball iniciada; pendiente autorización npm web2FA del propietario. No reconstruir ni publicar otra copia/version si el resultado se vuelve incierto: consultar registro e integridad primero.

### Orden para continuar más adelante

- Antes de promover a estable: cuotas completas MCP, límites de procesos fuera del grupo POSIX y del test runner, callbacks de entrevista/onboarding. Mantener alcance comprobable y sin promesa de sandbox.
- Recuperar capacidades contenidas: background con propietario y cierre, evaluación agregada con mediciones disponibles/aplicables.
- Producto: sesiones/rewind fiables, fluidez del terminal y UX, headless y VSIX.
- Capacidad real: contratos tool/schema y API/modelo revisados, contexto/prompts y comparativas con modelos reales, conservando catálogo existente salvo decisión documentada.
- Cierre global: deuda/cobertura objetivo80% y auditoría independiente con contexto limpio. La revisión de esta candidata no sustituye E15.
- Operación: revisar autenticación de publicación CI para evitar confirmación manual de cada release, sin eludir la política2FA de npm.

No se implementan esos extras en esta entrega. El resumen final de publicación se añadirá después de verificar npm y el paquete instalado.


## Cierre definitivo — 2026-09-17

**Publicado** @corbat-tech/coco@2.42.0-next.3 en next. `latest` permanece2.41.0. El propietario completó web2FA y `npm publish` terminó exit0. Comprobación desde registro con caché limpia: integridad idéntica a pack.json/tarball CI (SHA2565873acc3051086f1b3d619e2f67ae6a254b4f3ed4663648924d591337c85535d), instalación sin scripts y smoke CLI/exports/herramienta real de archivo PASS con provider fixture.

- [Release y archivos](https://github.com/corbat-tech/coco/releases/tag/v2.42.0-next.3).
- [Paquete npm](https://www.npmjs.com/package/@corbat-tech/coco/v/2.42.0-next.3).
- Instalación: `npm install -g @corbat-tech/coco@2.42.0-next.3` (Node22+).
- Evidencias locales: `.dev/evolution/e01-baseline/logs/next3-registry-install.log` y `next3-registry-smoke.log`; artefactos local/CI conservados en `.dev/evolution/` (ignorados por Git).

Publicación realizada localmente con2FA sobre artefacto CI exacto; el workflow pasó todas las comprobaciones pero su publicación automática sigue condicionada a la política2FA. No mover tag ni republicar versión; reconciliar hash si se reintenta cualquier operación. Todos los incrementos autorizados de este bloque están completados. Extras anteriores pausados, sin automatizaciones ni agentes implementando en segundo plano. Esta candidata no certifica estable ni cierre del programa global/E15.
