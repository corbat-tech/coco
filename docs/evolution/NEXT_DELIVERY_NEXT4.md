# Entrega next.4 — progreso persistido

Base: `2.42.0-next.3` / `55d3d8d`. Canal objetivo: `next`; no mover `latest`.

## Secuencia aprobada

- [x] MCP: límites de 16 MiB por frame/evento/cuerpo, UTF-8 incremental y cierre sin replay.
- [x] Test runner: ownership del grupo POSIX, salida limitada, cancelación y estados terminales fiables.
- [x] Entrevista/onboarding: cancelación desde el host, limpieza de callbacks y sin efectos tardíos.
- [x] Contratos locales: JSON Schema nativo de Zod 4 en modo entrada.
- [x] Contratos MCP: esquema original y validación Ajv sin modificar argumentos.
- [x] Adaptadores existentes: representación fiel o diagnóstico explícito; conservar modelos.
- [ ] Publicación: OIDC GitHub → npm; configurar confianza en cuenta propietaria.
- [ ] Gate completo, revisión independiente final, artefacto único e instalación limpia.
- [ ] Publicación verificada en npm y prerelease GitHub.

## Método

Cada incremento: implementación → pruebas aisladas → revisión independiente → correcciones → commit. No ejecutar tests en el checkout personal: recrear mirror temporal y sandbox si faltan los scripts anteriores. No rebajar cobertura ni afirmar cumplido el objetivo del 80 %.

Se conservan TypeScript, modelos actuales y APIs compatibles. Sin llamadas de inferencia de pago. Windows mantiene la limitación documentada al proceso directo. Pendientes posteriores: `calculate_quality`, background administrado, sesiones/rewind, VSIX, evaluación real y auditoría integral del plan completo.

## Registro

- Inicio: checkout limpio; scripts temporales de aislamiento de next.3 ya no existen. Recreación del entorno antes de probar. Implementación distribuida por subsistemas con revisión cruzada posterior.

- `006bd9b`: contratos locales/MCP y adaptadores; revisión independiente por integrador, 161 tests enfocados PASS + typecheck PASS. Catálogo completo de tools nativas preservado; OpenAI strict:false conserva opcionalidad; Google usa parametersJsonSchema. Validación MCP no modifica argumentos.
- Entorno aislado recreado en `/tmp/coco-evolution-location`, runner `/tmp/coco-check-increment.py`. 34 pruebas iniciales del test runner PASS, 20 pruebas de publicación PASS. Rerun de MCP tras migrar fixtures de Response.json a streams reales.
- Solicitada configuración npm Trusted Publisher al propietario; respuesta pendiente. Código OIDC preparado sin token en workflow.

- MCP: 110 tests PASS. Revisión independiente por agente de contratos e integrador sin bloqueantes. Cuotas son por frame/evento/cuerpo; no se promete cuota de stderr ni contención de memoria global de todo el agente.
- Test runner: 35 tests PASS, incluidos descendientes resistentes TERM (cancelación/finalización normal), proceso ajeno preservado y overflow real UTF-8. Revisión independiente sin bloqueantes. Captura execa en bytes (encoding buffer), no caracteres.

- Commits: `f490e29` MCP (110 tests PASS/revisión cruzada); `635db66` ownership runner; `1466ae1` OIDC (20 tests PASS/revisión cruzada).
- Runner ampliado tras revisión: 36 tests PASS, incluido overflow con descendiente TERM-resistant y captura UTF-8 por bytes. Ajustada normalización de salida tipada de execa; typecheck PASS.
- Cancelación: 174 tests PASS; revisión detectó y corrigió persistencia parcial del backlog (ahora temp+rename), procesos de browser/gcloud sin señal y probes que podían iniciar fallback tras abort. Fixture OAuth adicional corregido por descriptor promisify; revalidación pendiente.
- Proveedores: 303 tests PASS para API additive isAvailable({signal}); types/lint/format PASS. Una advertencia de lint preexistente en owned-shell.then, sin errores. Última corrección pendiente del wrapper de circuit breaker antes del gate.
- npm confirma `next.4` libre (E404), `latest=2.41.0`, `next=2.42.0-next.3`. Usuario está configurando Trusted Publisher.
