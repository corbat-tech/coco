# Entrega next.8 — contexto, configuración y validación real

Estado: implementación terminada de contexto/configuración; corrección final de checkpoints y gate global pendientes. No promover `latest` todavía.

## Cambios y evidencia

- Contexto de repositorio: presupuesto de selección explícito (no confundir con el total del prompt), orden determinista, caché con esquema/root/path validados e invalidación por metadatos. Sin permisos para seguir enlaces fuera del proyecto ni escribir por enlaces/hardlinks de caché.
- Compactación: conserva instrucciones originales, cola reciente y pares de tools; rechaza resúmenes vacíos, truncados, demasiado grandes o no beneficiosos. Conserva historial al cancelar, al cambiar proveedor o al llegar una instrucción nueva. `/compact` conectado a la sesión real.
- Ollama: se descubrió con inferencia real que `thinking:off` no llegaba al endpoint compatible. Se envía `reasoning_effort:none` únicamente para familias compatibles conocidas; GPT-OSS no recibe un apagado no soportado. Default/auto no cambian. [Compatibilidad oficial](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx), [thinking oficial](https://docs.ollama.com/capabilities/thinking).
- Prueba real de compactación con 24 pares de tools sintéticos: antes fallan4B/9B reteniendo historial; después ambos pasan dos compactaciones consecutivas y cancelación. 4B: estimación5169→1155 y8833→702. No equivale a una tarea autónoma larga; resúmenes y resultados completos en `evidence/ollama-context-*.json`.
- `/thinking off` conserva su elección en memoria y al reiniciar; fallos de persistencia no cambian el estado activo. MCP conserva valores de entorno con `=`. Skills usa argv separado, valida nombres y escapa YAML.
- Nuevas pruebas sobre proyectos/manifiestos reales, confianza y sesiones persistidas. No se han bajado umbrales ni añadido exclusiones para mejorar la cobertura.
- Checkpoints antiguos: detectado uso de `git add -A`, `checkout .` y `clean -fd`. Sustituir por captura sin alterar index/worktree y restauración estrictamente comprobada; no considerar cerrada recuperación hasta pasar esta regresión.

## Criterios de cierre

- [ ] Checkpoints: sin borrar cambios ajenos, metadata/proyecto/HEAD/OID verificados; legacy solo lectura; pruebas Git reales e independientes.
- [ ] Gate completo ≥80% líneas y statements, además de umbrales existentes, build y clean install.
- [ ] Repetir corpus2 con4B/9B dos veces usando el paquete instalado. Evaluadorv3 exige terminación en todos los turnos; resultados anteriores con budget agotado no son éxito completo.
- [ ] Ejecutar casos reservados `evidence/heldout-cases-v1.json` sin adaptar los prompts tras observar resultados. Distinguir resultado del código, terminación y respeto de restricciones.
- [ ] Auditorías producto/capacidad/ingeniería; corregir bloqueantes y registrar límites. Los revisores con contexto anterior deben declararlo; revisión ciega local con Ollama sin historial interno por separado.
- [ ] Publicación next.8 y RC verificadas; estable2.42.0 únicamente si cumplen los gates y las auditorías.

## Reproducción

Ejecutar en un checkout/consumer desechable, con Node22 y entorno mínimo, dentro de un sandbox que permita únicamente el proyecto sintético y Ollama localhost. No ejecutar fixtures con permisos sobre archivos personales. Los scripts no descargan modelos ni usan fallback cloud.

- `node scripts/eval-ollama.mjs <consumer-instalado> qwen3.5:4b <salida-nueva>` (repetir9B y segunda salida).
- `node scripts/eval-ollama.mjs <consumer-instalado> qwen3.5:9b <salida-nueva> all docs/evolution/evidence/heldout-cases-v1.json`.
- `node --import tsx scripts/eval-ollama-context.ts qwen3.5:4b <informe.json>` desde el checkout aislado; repetir9B.

Conservar logs, commit, versión, digest del modelo, verificadores y fallos. La prueba real de modelos no sustituye pruebas de protocolo simuladas para proveedores de pago.
