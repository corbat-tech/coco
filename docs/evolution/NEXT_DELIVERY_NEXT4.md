# Entrega next.4 — progreso persistido

**Estado final: next.4 publicada y verificada en npm, con prerelease GitHub creada.** El registro inferior es cronológico.

Base: `2.42.0-next.3` / `55d3d8d`. Canal objetivo: `next`; no mover `latest`.

## Secuencia aprobada

- [x] MCP: límites de 16 MiB por frame/evento/cuerpo, UTF-8 incremental y cierre sin replay.
- [x] Test runner: ownership del grupo POSIX, salida limitada, cancelación y estados terminales fiables.
- [x] Entrevista/onboarding: cancelación desde el host, limpieza de callbacks y sin efectos tardíos.
- [x] Contratos locales: JSON Schema nativo de Zod 4 en modo entrada.
- [x] Contratos MCP: esquema original y validación Ajv sin modificar argumentos.
- [x] Adaptadores existentes: representación fiel o diagnóstico explícito; conservar modelos.
- [x] Publicación: OIDC GitHub → npm; configurar confianza en cuenta propietaria.
- [x] Gate completo, revisión independiente final, artefacto único e instalación limpia.
- [x] Publicación verificada en npm y prerelease GitHub.

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

- `30573ea`: entrevista/onboarding/auth; 174 tests + 3 OAuth PASS. Revisión independiente confirmó correcciones, sin bloqueantes en este bloque.
- `23a10bf`: probes cancelables de proveedores. 303 tests + 8 de wrapper PASS. Cancelación no cuenta como fallo del circuit breaker ni borra fallos previos (revisión cruzada + regresiones).
- `97d9b87`: overflow real con descendiente resistente y normalización binaria. 36 tests runner PASS.
- Gate completo `pnpm check:release` en ejecución en mirror aislado con Node 22.23.2. Sin inferencia real ni acceso a credenciales en tests. Nueva revisión final del diff solicitada; publicación aún no intentada.

## Configuración de publicación

npm Trusted Publisher: GitHub Actions, owner `corbat-tech`, repository `coco`, workflow filename `release.yml`, environment vacío. Workflow usa npm 11.17.0 y permisos id-token:write; no inyecta NPM_TOKEN. Configurar desde cuenta propietaria antes del tag. Mantener 2FA y secreto anterior sin usar; no borrarlo como parte de esta entrega.

## Documentación contrastada

- https://zod.dev/json-schema — conversión nativa de esquemas de entrada.
- https://ajv.js.org/json-schema — validadores separados por dialecto.
- https://developers.openai.com/api/docs/guides/function-calling — opcionalidad y strict:false.
- https://googleapis.github.io/js-genai/release_docs/interfaces/types.FunctionDeclaration.html — parametersJsonSchema.
- https://docs.npmjs.com/trusted-publishers/ — publicación OIDC.

## Gate y revisión final

- Gate completo PASS en 75,38 s: types, lint (advertencia preexistente), formato, 7.996 tests principales PASS / 15 skipped, 27 tests REPL PASS y build JS/declaraciones PASS.
- Cobertura: 70,69 % statements; 63,14 % branches; 76,21 % functions; 71,33 % lines. No se han reducido umbrales; objetivo 80 % sigue como deuda.
- Revisión final independiente del diff: sin bloqueantes después de las correcciones. Es revisión de esta entrega, no auditoría integral ni evaluación con modelos reales.
- Los estados pendientes en el registro cronológico anterior quedaron resueltos: fixture OAuth (3 PASS), breaker (8 PASS), pruebas y build global.
- Empaquetado/instalación limpia en curso. No se ha creado tag ni intentado publicación mientras se configura npm Trusted Publisher.

- Candidato local instalado/verificado: CLI --version/--help, exports y runtime con herramienta real de archivos PASS (proveedor simulado). Integridad `sha512-+9je9E3NxjFbqZfiPje7A477xndRfZLTlXzdEjTHWyZ0+duLEemztf1LHWvqJ81+xx4R712KlnWbV2j5v2q7/w==`. Artefacto conservado en `.dev/evolution/candidate-2.42.0-next.4/`; logs en `.dev/evolution/next4-logs/` (ignorados por Git).
- Código listo para etiquetar/publicar; pendiente confirmación de configuración del Trusted Publisher. El tarball que publique Actions debe superar de nuevo su gate y coincidir con la integridad registrada en npm.

## Publicación OIDC y reconciliación

- Usuario confirmó Trusted Publisher guardado con publicación directa habilitada.
- Tag `v2.42.0-next.4` → `a277c49`; workflow https://github.com/corbat-tech/coco/actions/runs/35254601994 . Gate Linux, build, pack y smoke instalable PASS. Comando npm publish terminó con código 0; verificación inmediata de dist-tag falló. No se ha repetido la subida.
- npm documenta escaneo previo a disponibilidad: https://github.com/orgs/community/discussions/203413 . Registro todavía E404 para next.4 mientras se reconcilia. No declarar publicada hasta comprobar disponibilidad, integridad y canal.
- Artefacto CI descargado coincide byte por byte con local: SHA256 `47fa77c507d8fb0d7e57f48edce7603f15f79266201e5d0a4b7e86bff4ffce99`. Retenido en `.dev/evolution/ci-candidate-2.42.0-next.4/`.
- Corrección acotada del script de publicación en curso: esperar visibilidad mediante lecturas (hasta 10 minutos), comprobar integridad y canal, sin republish automático. Tag y paquete permanecen inmutables.

- A las 19:51 CEST, registro visible: `next=2.42.0-next.4`, `latest=2.41.0`; integridad exacta coincide con candidato CI/local. Publicación OIDC confirmada tras retraso de aproximadamente cuatro minutos por visibilidad.
- Corrección del script de espera revisada por integrador; 28 tests de publicación PASS. No afecta al tarball next.4 ni mueve su tag. Queda en la rama para futuras publicaciones.
- Relanzado únicamente el workflow fallido: reconocerá versión ya existente e idéntica, omitirá publicación y completará instalación/release GitHub.

- Instalación limpia desde npm PASS: CLI --version/--help, exports públicos y runtime con herramienta real de archivos (proveedor simulado). `next.4` pública y verificable; `latest=2.41.0` intacto.
- `f348f37`: espera de visibilidad del registro revisada + 28 tests PASS. Cambio operativo posterior al tag, no incluido en el tarball ni necesario para usar Coco; protege futuras publicaciones.

## Próximas entregas (no ejecutadas aquí)

1. Evaluación pequeña de tareas reales con modelos actuales, fijando primero presupuesto y criterios de éxito. Medir calidad de diffs, pruebas, coste y capacidad de recuperación.
2. Restaurar `calculate_quality` con evidencia real y criterios de aplicabilidad; mantener estado indisponible hasta validarlo.
3. Restaurar background solo con propietario, cancelación y limpieza comprobables; mejorar recuperación de sesiones/rewind sin perder cambios ajenos.
4. Subir cobertura hacia 80 % con casos de riesgo, pulir UX y retomar VSIX cuando supere su gate específico.
5. Auditoría externa integral sin contexto y prueba de adopción por consultor al cerrar el programa. Nuevos modelos o extracción de arquitectura solo por necesidad demostrada.

## Cierre definitivo

- **Entregado `@corbat-tech/coco@2.42.0-next.4` en canal `next`. `latest=2.41.0` sin cambios.**
- https://www.npmjs.com/package/@corbat-tech/coco/v/2.42.0-next.4
- Prerelease: https://github.com/corbat-tech/coco/releases/tag/v2.42.0-next.4
- Actions (intento 2): https://github.com/corbat-tech/coco/actions/runs/35254601994 . Job npm completo en verde: gate, build, pack, instalación del artefacto, reconciliación sin republish, integridad del registro e instalación desde npm. Prerelease creada por Actions.
- El primer intento sí presentó el paquete mediante OIDC; falló solo la comprobación prematura. El segundo reconoció la versión idéntica publicada, sin modificarla ni volver a subirla. Corrección preventiva `f348f37` queda disponible para futuras entregas.
- Revisión independiente de cada bloque y revisión final sin bloqueantes. Sin inferencia pagada ni auditoría integral de producto: permanecen como siguientes entregas explícitas.
- No quedan tareas de implementación/publicación de esta entrega. Mantener tag/artifact inmutables. Continuación futura: prioridades del apartado anterior, comenzando por evaluación real acotada y restauración fundamentada de calidad.

- Cierre GitHub: intento 2 creó la prerelease pero falló temporalmente al subir adjuntos (`Error creating asset temp dir`). Intento 3 relanzó solo el job de GitHub y terminó **SUCCESS**. Los cuatro adjuntos están presentes: tarball, pack.json, registry-integrity.txt y SHA256SUMS. Workflow completo en verde. No se volvió a publicar npm.
