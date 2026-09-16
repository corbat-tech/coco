# Coco next.3: pendientes imprescindibles

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
- [ ] Gate completo, tarball y smoke.
- [ ] Publicación y verificación npm; release y handoff actualizado.

## Pospuesto

E08 fidelidad completa de schemas/API/modelos; E09 mediciones de calidad disponibles/aplicables (calculate_quality continúa indisponible); E10 recuperación/rewind; E11 headless/VSIX; E12 UX; E13 contexto/prompts y comparativas con modelos reales; E14 deuda y objetivo80% de cobertura; E15 auditoría integral con contexto limpio. Cuotas completas de frames MCP, callbacks onboarding y otras superficies de proceso requieren su propio alcance; no se anuncian resueltas aquí. Estos pendientes tienen valor, pero no justifican ampliar esta entrega.
