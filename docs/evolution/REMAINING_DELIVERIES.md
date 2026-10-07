# Cierre de mejora de Coco — entregas restantes

Base inicial: 2.42.0-next.4; última entrega confirmada: **2.42.0-rc.2 + VSIX 2.42.0**. Presupuesto API adicional: **0 €**. Incluye background y VSIX. Cierre técnico: candidato RC2; promoción estable pendiente por dictamen de capacidad. Ver [handoff actual](HANDOFF_2026-09-17.md).

## Cambio aprobado: evaluación local con Ollama

Hasta next.4 solo se ejecutaron proveedores simulados; no había medición real de capacidad. Ollama 0.34.1 está disponible en localhost:11434, con qwen3.5:4b (2a654d98e6fb), qwen3.5:9b (6488c96fa5fa), qwen2.5-coder:14b-instruct, llama3.2 y nomic-embed-text ya instalados. Primero qwen3.5:4b por latencia; contrastar con 9b sin descargar modelos ni llamar APIs externas. Verificar herramientas con el adaptador Ollama existente; conservar fallos como evidencia.

Cada caso: repositorio sintético aislado, máximo 10 minutos y 30 llamadas; registrar versión/modelo/digest, tokens/tiempo, acciones, errores, diff y verificador externo. Dos repeticiones para comparación final; casos reservados sin optimizar prompts contra ellos. Las inferencias locales son reales; los fixtures simulados siguen siendo pruebas de protocolo. No extrapolar los resultados locales a todos los modelos.

## Secuencia y aceptación

- [x] next.5 — mapa actualizado, corpus bug/feature/refactor/recuperación/sesión de dos turnos y referencia next.4; calidad medida/no aplicable/no disponible/error, aceptación distinta de convergencia y hash del contenido evaluado.
- [x] next.6 — background propiedad de sesión/proyecto, 2 trabajos, 30min, 16MiB/canal; consultar/leer/cancelar, cierre POSIX; Windows indisponible hasta prueba del árbol. Sesiones/checkpoints/rewind sin sobrescribir cambios ajenos ni repetir efectos.
- [x] next.7 + VSIX — JSON/headless coherente y stdin acotado; terminal no bloqueado por updates; extensión con ejecutable/argv seguro, multiroot, Workspace Trust y Extension Host real. VSIX GitHub; Marketplace solo con acceso ya configurado.
- [x] next.8 — presupuesto de tokens/contexto e invalidación de caché; compactación preserva restricciones; cambios de prompts guiados por evaluación. Cobertura ≥80% líneas/statements sin nuevas exclusiones ni bajar otros umbrales.
- [ ] rc.1 → estable 2.42.0 — tres revisores independientes (usuario, capacidad, ingeniería), primero sin historial interno; uso real de Ollama y casos reservados; corregir bloqueantes, máximo dos rondas por causa. Publicar estable solo con evidencia suficiente; si no, mantener RC y explicar bloqueo.

## Método y publicación

Criterio → implementación → pruebas en mirror/sandbox → revisión independiente → corrección → commit → registro. No ejecutar tests sobre archivos personales. Publicación OIDC por entrega, escaneo/visibilidad npm hasta10min, integridad y clean install; latest solo al cierre estable. No mutar tags ni republicar versiones existentes. VSIX gate separado. Sin migración de lenguaje/framework, modelos adicionales, hosted/multitenancy o scheduler nuevo.

## Registro

- Inicio: checkout limpio en 422a295. Ollama operativo y modelos enumerados sin descargar. Subtareas calidad y background en implementación; integrador prepara corpus y referencia local. No se ha publicado una versión posterior a next.4.

- Referencia Ollama ejecutada: next.4 + qwen3.5:4b 4/5; next.4 + qwen3.5:9b 5/5. Casos sintéticos; sesión inicial de dos turnos. Estrés prolongado y comparación repetida quedan en next.8. Evidencias persistidas en `evidence/`; detalle en `NEXT_DELIVERY_NEXT5.md`.

- next.5 cerrada: 8.019 pruebas principales + 27 REPL, build/clean install, Actions OIDC e integridad npm PASS. next.6 verificada localmente y enviada a publicación; next.7 y next.8 en implementación/revisión. No se considera completado el objetivo global de cobertura.

- next.6 publicada: gate8037+28 y Actions35263217498 PASS. next.7 en gate exacto. Ollama repetido: código20/20, éxito completo como máximo19/20 por agotamiento de iteraciones; evaluadorv3 ahora exige terminación sin herramientas pendientes. La prueba de compactación real detectó `thinking:off` ignorado en Ollama; se corrige el payload según documentación oficial antes de repetir.

- next.7 y VSIX publicados y verificados. Próximo cierre documentado en `NEXT_DELIVERY_NEXT8.md`; evaluación local ya ha producido una corrección real de API/compactación. Corregir también checkpoints antiguos destructivos antes de estable.

- next.8 publicada y verificada: commit34f4a7c, Actions35267933015 PASS, npm next y assets GitHub. Gate8310+28,80.01% statements/80.73% líneas y clean install PASS. El corpus repetido del candidato previo7fb9aca da20/20, con límites de alcance documentados. Casos reservados finales aún en curso; RC1 preparada sin nuevos cambios runtime. No promover estable antes de adjudicar esos resultados.

- RC1 `4aa7ec0` publicada en npm y GitHub: Actions35268904690 PASS tras reintentar únicamente la subida de assets (error temporal inicial); `next=2.42.0-rc.1`, `latest=2.41.0`. SHA256 publicado `bedc0be06f520e903ac599c4c76997939812eb7fadd2736eb60741ed1ef56ab7`. Los reservados detectaron un P1 del runtime experimental: respuesta no terminal podía anunciar éxito; corrección mínima en curso también para runner simple y streaming. No promover esta RC a estable.

- Auditoría final de capacidad: mantener RC2 para piloto supervisado;2/6 reservados completos y4/6 código correcto con perfiles thinking:off. No atribuirlo al default ni afirmar superioridad. P1 de falso éxito corregido en5bd23ef; revisión independiente y gate8337+28/80.02% statements/80.75% líneas PASS. RC2 publicada/verificada: Actions35270377516 PASS, next=2.42.0-rc.2, latest=2.41.0; cuatro assets GitHub e integridad coincidente. El tramo RC→estable no se marca completo: faltan perfil recomendado validado y recorrido práctico independiente del producto instalado.
