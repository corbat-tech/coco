# Entrega next.8 — contexto, configuración y validación real

Estado: implementación y revisión cerradas en `34f4a7c`; gate exacto e instalación limpia PASS. Publicación next.8 verificada (Actions35267933015 PASS, npm next y cuatro assets GitHub); evaluaciones finales pendientes. No promover `latest` todavía.

## Cambios y evidencia

- Contexto de repositorio: presupuesto de selección explícito (no confundir con el total del prompt), orden determinista, caché con esquema/root/path validados e invalidación por metadatos. Sin permisos para seguir enlaces fuera del proyecto ni escribir por enlaces/hardlinks de caché.
- Compactación: conserva instrucciones originales, cola reciente y pares de tools; rechaza resúmenes vacíos, truncados, demasiado grandes o no beneficiosos. Conserva historial al cancelar, al cambiar proveedor o al llegar una instrucción nueva. `/compact` conectado a la sesión real.
- Ollama: se descubrió con inferencia real que `thinking:off` no llegaba al endpoint compatible. Se envía `reasoning_effort:none` únicamente para familias compatibles conocidas; GPT-OSS no recibe un apagado no soportado. Default/auto no cambian. [Compatibilidad oficial](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx), [thinking oficial](https://docs.ollama.com/capabilities/thinking).
- Prueba real de compactación con 24 pares de tools sintéticos: antes fallan4B/9B reteniendo historial; después ambos pasan dos compactaciones consecutivas y cancelación. 4B: estimación5169→1155 y8833→702. No equivale a una tarea autónoma larga; resúmenes y resultados completos en `evidence/ollama-context-*.json`.
- `/thinking off` conserva su elección en memoria y al reiniciar; fallos de persistencia no cambian el estado activo. MCP conserva valores de entorno con `=`. Skills usa argv separado, valida nombres y escapa YAML.
- Nuevas pruebas sobre proyectos/manifiestos reales, confianza y sesiones persistidas. No se han bajado umbrales ni añadido exclusiones para mejorar la cobertura.
- Checkpoints antiguos: detectado uso de `git add -A`, `checkout .` y `clean -fd`. Sustituido por captura sin alterar index/worktree y restauración estrictamente comprobada. Regresiones Git reales y revisión independiente cerradas, incluida protección de destinos ignorados ante renombrados.

## Criterios de cierre

- [x] Checkpoints: sin borrar cambios ajenos, metadata/proyecto/HEAD/OID verificados; legacy solo lectura; pruebas Git reales e independientes.
- [x] Gate completo ≥80% líneas y statements, además de umbrales existentes, build y clean install.
- [x] Repetir corpus2 con4B/9B dos veces usando el paquete instalado. Evaluadorv3 exige terminación en todos los turnos; resultados anteriores con budget agotado no son éxito completo.
- [ ] Ejecutar casos reservados `evidence/heldout-cases-v1.json` sin adaptar los prompts tras observar resultados. Distinguir resultado del código, terminación y respeto de restricciones.
- [ ] Auditorías producto/capacidad/ingeniería; corregir bloqueantes y registrar límites. Los revisores con contexto anterior deben declararlo; revisión ciega local con Ollama sin historial interno por separado.
- [ ] Publicación next.8 y RC verificadas; estable2.42.0 únicamente si cumplen los gates y las auditorías.

## Reproducción

Ejecutar en un checkout/consumer desechable, con Node22 y entorno mínimo, dentro de un sandbox que permita únicamente el proyecto sintético y Ollama localhost. No ejecutar fixtures con permisos sobre archivos personales. Los scripts no descargan modelos ni usan fallback cloud.

- `node scripts/eval-ollama.mjs <consumer-instalado> qwen3.5:4b <salida-nueva>` (repetir9B y segunda salida).
- `node scripts/eval-ollama.mjs <consumer-instalado> qwen3.5:9b <salida-nueva> all docs/evolution/evidence/heldout-cases-v1.json`.
- `node --import tsx scripts/eval-ollama-context.ts qwen3.5:4b <informe.json>` desde el checkout aislado; repetir9B.

Conservar logs, commit, versión, digest del modelo, verificadores y fallos. La prueba real de modelos no sustituye pruebas de protocolo simuladas para proveedores de pago.

## Gate del candidato final

Commit `34f4a7c`: 8310 pruebas principales y28 REPL PASS (15 omitidas), typecheck/lint/formato/build PASS. Cobertura:80.01% statements,80.73% líneas,70.81% ramas,82.06% funciones; umbrales de líneas/statements elevados a80 en la configuración. Instalación limpia del tarball y smoke de CLI/exports/herramienta real PASS. SHA256 local `ce6363fc54d6b2367067e25c982276e064a27e3e04559e42bf21e19052a2defb`; no confundir con el artefacto Linux publicado, que se verifica por separado.

La repetición del corpus comenzó sobre `7fb9aca` (candidato previo a los ajustes finales de permisos), no sobre el artefacto final. Los casos reservados usarán el consumidor instalado de `34f4a7c`. No presentar los20 casos repetidos como validación exacta de ese último artefacto.

Publicación next.8 confirmada: SHA256 del asset GitHub `ce6363fc54d6b2367067e25c982276e064a27e3e04559e42bf21e19052a2defb`, idéntico al tarball local evaluado; integridad npm `sha512-0D7DjKHfKPUvxMtuwUKARdJ1kSmQT6kSXM9llM6cQqstEi+DpgZWiV9IBbbQHpuD25QdO5Aet0hUQ2CHFAK3OQ==`. Registro `next=2.42.0-next.8`, `latest=2.41.0`. RC1 `4aa7ec0` (sin cambios runtime) pasa gate completo y clean install; publicación iniciada, todavía no acreditada.
