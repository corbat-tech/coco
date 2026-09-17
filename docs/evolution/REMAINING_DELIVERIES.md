# Cierre de mejora de Coco — entregas restantes

Base publicada: 2.42.0-next.4. Presupuesto API adicional: **0 €**. Incluye background y VSIX. Última instrucción: usar Ollama para evaluación real y ejecutar el plan.

## Cambio aprobado: evaluación local con Ollama

Hasta next.4 solo se ejecutaron proveedores simulados; no había medición real de capacidad. Ollama 0.34.1 está disponible en localhost:11434, con qwen3.5:4b (2a654d98e6fb), qwen3.5:9b (6488c96fa5fa), qwen2.5-coder:14b-instruct, llama3.2 y nomic-embed-text ya instalados. Primero qwen3.5:4b por latencia; contrastar con 9b sin descargar modelos ni llamar APIs externas. Verificar herramientas con el adaptador Ollama existente; conservar fallos como evidencia.

Cada caso: repositorio sintético aislado, máximo 10 minutos y 30 llamadas; registrar versión/modelo/digest, tokens/tiempo, acciones, errores, diff y verificador externo. Dos repeticiones para comparación final; casos reservados sin optimizar prompts contra ellos. Las inferencias locales son reales; los fixtures simulados siguen siendo pruebas de protocolo. No extrapolar los resultados locales a todos los modelos.

## Secuencia y aceptación

- [ ] next.5 — mapa actualizado, corpus bug/feature/refactor/recuperación/sesión larga y referencia next.4; calidad medida/no aplicable/no disponible/error, aceptación distinta de convergencia y hash del contenido evaluado.
- [ ] next.6 — background propiedad de sesión/proyecto, 2 trabajos, 30min, 16MiB/canal; consultar/leer/cancelar, cierre POSIX; Windows indisponible hasta prueba del árbol. Sesiones/checkpoints/rewind sin sobrescribir cambios ajenos ni repetir efectos.
- [ ] next.7 + VSIX — JSON/headless coherente y stdin acotado; terminal no bloqueado por updates; extensión con ejecutable/argv seguro, multiroot, Workspace Trust y Extension Host real. VSIX GitHub; Marketplace solo con acceso ya configurado.
- [ ] next.8 — presupuesto de tokens/contexto e invalidación de caché; compactación preserva restricciones; cambios de prompts guiados por evaluación. Cobertura ≥80% líneas/statements sin nuevas exclusiones ni bajar otros umbrales.
- [ ] rc.1 → estable 2.42.0 — tres revisores independientes (usuario, capacidad, ingeniería), primero sin historial interno; uso real de Ollama y casos reservados; corregir bloqueantes, máximo dos rondas por causa. Publicar estable solo con evidencia suficiente; si no, mantener RC y explicar bloqueo.

## Método y publicación

Criterio → implementación → pruebas en mirror/sandbox → revisión independiente → corrección → commit → registro. No ejecutar tests sobre archivos personales. Publicación OIDC por entrega, escaneo/visibilidad npm hasta10min, integridad y clean install; latest solo al cierre estable. No mutar tags ni republicar versiones existentes. VSIX gate separado. Sin migración de lenguaje/framework, modelos adicionales, hosted/multitenancy o scheduler nuevo.

## Registro

- Inicio: checkout limpio en 422a295. Ollama operativo y modelos enumerados sin descargar. Subtareas calidad y background en implementación; integrador prepara corpus y referencia local. No se ha publicado una versión posterior a next.4.

- Referencia Ollama ejecutada: next.4 + qwen3.5:4b 4/5; next.4 + qwen3.5:9b 5/5. Casos sintéticos; sesión inicial de dos turnos. Estrés prolongado y comparación repetida quedan en next.8. Evidencias persistidas en `evidence/`; detalle en `NEXT_DELIVERY_NEXT5.md`.
