# Auditoría de producto: Coco como herramienta de un consultor

Fecha: 17 de septiembre de 2026. Punto de comparación instalado: `@corbat-tech/coco` **2.42.0-next.7**. La revisión inicial se conserva a continuación. La adjudicación posterior corresponde al commit `34f4a7c`; este documento no acredita todavía su publicación como next.8 ni una promoción a estable.

## Dictamen

**Sí utilizaría Coco para un piloto supervisado en repositorios de confianza. Todavía no lo presentaría como un agente que garantiza calidad medida ni como una plataforma empresarial lista para operar sin supervisión.** La combinación de proveedores, herramientas, sesiones y runtime reutilizable tiene utilidad concreta para Corbat. La siguiente mejora de producto debe ser demostrar resultados repetibles con tareas reales y explicar con precisión qué está verificado, antes de ampliar los casos de uso.

Es un agente de programación con una base técnica sustancial. No hay evidencia en esta auditoría para afirmar que supera a Codex, Claude Code u otros agentes, ni para cuantificar su autonomía en proyectos de clientes. La revisión no justifica una migración de lenguaje o un nuevo framework: los problemas encontrados son contratos de uso, conservación de estado y documentación.

## Independencia y método

Esta revisión **no es ciega**: su autor participó en cambios de ejecución y recuperación y conoce contexto previo. Adoptó una perspectiva de comprador/consultor leyendo primero README, Quick Start y ayuda del paquete instalado, sin usar inicialmente los Markdown internos de progreso. La independencia del análisis no equivale a una auditoría de una empresa externa.

Se ejecutaron exclusivamente consultas de ayuda/versiones del paquete consumidor instalado; no se llamaron APIs de pago ni se lanzaron inferencias de Ollama durante esta auditoría. Las comprobaciones de regresión posteriores se ejecutaron en `/tmp/coco-recovery-gate-FLSu7S`, no en el checkout personal.

La calidad de las respuestas del modelo en tareas nuevas queda fuera de esta muestra: el responsable de la entrega prepara por separado pruebas locales y casos reservados. Sus resultados deben adjuntarse antes de declarar una validación funcional completa.

## Evidencia observable del paquete instalado

| Comprobación         | Resultado                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `coco --version`     | `2.42.0-next.7`                                                                                            |
| `coco --help`        | CLI arranca; identifica honestamente `build` y `resume` de nivel superior como heredados no implementados. |
| `coco chat --help`   | Expone proveedor/modelo, ruta, `--print`, `--output` y `--runtime-runner` experimental.                    |
| `coco skills --help` | Descubrimiento, instalación, creación, retirada y diagnóstico de skills accesibles.                        |
| `coco mcp --help`    | Alta, retirada, listado y activación/desactivación de servidores accesibles.                               |

Directorio consumidor: `/private/var/folders/xb/5fbp5s_90_bdnw9kwg9116sw0000gn/T/coco-next4-p2dh5yrl/consumer-next7-final`. Se usó el Node aislado de `../node-bin/node`. La ayuda confirma superficie y descubribilidad, no ejecución correcta de todas las capacidades anunciadas.

## Hallazgos y resolución

### P1 — La documentación inicial confundía autorrevisión con aceptación medida

README decía que la ejecución iteraba hasta superar verificaciones. Quick Start mostraba un supuesto recorrido automático de cuatro fases, puntuaciones, cobertura y cero vulnerabilidades como resultado típico sin distinguir una ilustración de un resultado medido. El comando real `/quality` explica expresamente que los informes del modelo no están verificados (`src/cli/repl/commands/quality.ts`). Un consultor podía inferir una garantía que el producto no proporciona.

**Corrección candidata:** README y Quick Start distinguen autorrevisión de herramientas de medición, eliminan el resultado numérico ilustrativo y explican que completar un turno no certifica aceptación. No se han eliminado los analizadores reales. En la revisión inicial quedaba pendiente homogeneizar `docs/guides/QUALITY.md`. En `34f4a7c` se ha vuelto a leer la guía: distingue autorrevisión, revisión de cambios y evaluación con evidencia, identifica heurísticas y evidencia ausente, y aclara que detener una iteración no equivale a aceptar su resultado. Ese pendiente editorial queda resuelto en el candidato.

### P1 — Cancelar el guardado en setup podía anunciar éxito

En `src/cli/index.ts`, `coco setup` ignoraba el resultado booleano de `saveConfiguration` y siempre anunciaba configuración guardada después de completar la selección de proveedor. `coco chat --setup` también continuaba tras cancelar el guardado.

**Corrección candidata:** ambos flujos detienen la operación al recibir `false`; la confirmación de éxito solo se muestra cuando guardar termina correctamente. Cuatro regresiones pasan con Commander real y frontera de onboarding simulada: cancelación en ambos comandos, cancelación inicial y guardado satisfactorio. No se prueba un OAuth real ni una escritura remota.

### P2 — Instrucciones de configuración que no existían como comando REPL

Quick Start recomendaba `/config quality.minScore 75` y `/config quality.minScore 92`. El registro real `src/cli/repl/commands/index.ts` no incluye `/config`. Esto bloquea una acción de la guía de primeros pasos.

**Corrección candidata:** sustituido por un ejemplo de `.coco.config.json`; se dirige a `coco check --help` para conocer la superficie de medición. Se aclara que cambiar umbrales no aporta evidencia ausente.

### P2 — Headless y límites de permisos poco visibles

La ayuda raíz no orientaba al usuario hacia `coco chat --help`. README repetía el arranque interactivo bajo “direct task” y omitía un ejemplo de automatización. Además, `--print` ejecuta herramientas sin confirmaciones interactivas; la ausencia de preguntas no equivale a modo de solo lectura.

**Corrección candidata:** ayuda raíz enlaza conceptualmente con `coco chat --help`; README y Quick Start incluyen un ejemplo JSON y explican permisos, checkout de confianza y significado limitado de `success`. Se conserva el carácter experimental de `--runtime-runner`.

### P2 — Confusión entre versión estable y preview

La portada anuncia mejoras 2.42 mientras el comando de instalación selecciona `latest`. Un usuario podía esperar mejoras que solo existen en `next`.

**Corrección candidata:** indicación explícita de ambos canales y verificación de versión. No se recomienda presentar una preview como estable.

### P3 — Superficie amplia y mensajes todavía heterogéneos

La ayuda `--provider` enumera un subconjunto de proveedores y no muestra Ollama pese a que el producto lo admite. La portada alterna agente de programación y casos empresariales experimentales. Hay margen para un recorrido más corto: instalar, elegir proveedor, planificar, implementar, verificar cambios y recuperar sesión. Son mejoras editoriales posteriores; no requieren rediseñar la arquitectura.

## Fortalezas y límites de la evidencia

- **Uso realista:** CLI instalable, perfiles de proveedores y herramientas extensibles. La ayuda reconoce funciones heredadas no implementadas en lugar de simular éxito.
- **Separación práctica de producto y runtime:** permite mantener Coco centrado en programación y reutilizar componentes para agentes de Corbat. Un producto empresarial todavía debe aportar autenticación, aislamiento por cliente y herramientas específicas.
- **Recuperación más conservadora:** pruebas con archivos reales verifican postimagen antes de restaurar, aislamiento por sesión/proyecto y cancelación sin cambios. La secuencia de cierre/reasignación del runtime en esas pruebas está simulada; no sustituye los tests de procesos reales.
- **Mejoras sustentadas en casos concretos:** el control explícito de thinking de Ollama se ha corregido a partir de un problema observado por el responsable de la entrega, no por una preferencia estética. Esta auditoría no repitió aquella inferencia.
- **No hay certificado global de seguridad:** las pruebas cubren contratos definidos. Hooks, shell, MCP y repositorios de terceros siguen siendo superficies de ejecución que requieren una política adecuada al entorno.

Se identificó además un mecanismo antiguo de checkpoint Git con restauración destructiva durante la revisión de entrega del responsable. La implementación candidata fue revisada posteriormente: reemplaza limpieza destructiva por captura no mutante y aplicación de un objeto Git ligado al proyecto/HEAD, con rechazo de árboles sucios y metadatos antiguos sin vínculo. Esta revisión detectó y reprodujo un defecto adicional: un renombrado podía sobrescribir un destino ignorado ajeno porque el filtro de adiciones omitía los renombrados. El responsable añadió `--no-renames` y una regresión con archivo centinela. **La corrección ha pasado la revisión de código y la suite comunicada por su responsable: 23 pruebas, incluidas 17 con Git real. El gate del candidato exacto también está acreditado en el cierre inferior; la publicación permanece pendiente.**

## Revisión independiente adicional de pruebas de detección de stack

`src/cli/repl/context/stack-detector.test.ts` utiliza manifiestos reales en directorios temporales, comprueba actualización del contexto al cambiar dependencias y evita recomendaciones Node en proyectos Java/Python/Go/Rust. La prueba con `postinstall` y archivo centinela aporta evidencia de que esa ruta no ejecuta scripts; la implementación inspeccionada lee archivos y no invoca procesos. No demuestra por sí sola ausencia de toda ejecución posible fuera del detector. Sin hallazgos bloqueantes en este alcance.

## Condiciones para recomendar la siguiente entrega

1. Pasar gates del conjunto exacto que se publique y verificar instalación desde el artefacto final.
2. Resolver y probar el checkpoint Git heredado sin borrar cambios ajenos.
3. Adjuntar casos reales reservados con resultado, tests ejecutados, coste/tiempo y fallos; distinguir éxito de herramienta de corrección de la solución.
4. Completar la coherencia editorial de la guía de calidad y conservar las limitaciones visibles.
5. Mantener la siguiente evolución centrada en fiabilidad, tiempos de respuesta y experiencia de programación; dejar expansión empresarial, framework adicional y migración de lenguaje para una necesidad demostrada.

Con estas condiciones, la propuesta es suficientemente útil para probarla en trabajo de consultoría supervisado. La afirmación de “mejor versión posible” debe traducirse en límites verificables y tareas terminadas de forma fiable, no en número de funcionalidades.

## Cierre de revisión adicional: evidencia de `review_code`

Se revisó independientemente la corrección candidata de `src/tools/review.ts`: una referencia Git base inexistente y un linter solicitado pero no disponible ya no producen estado `approved`. La ausencia de diferencias verificadas sí sigue siendo distinguible de no poder obtener las diferencias. Las ocho pruebas propuestas usan Git real y simulan únicamente la frontera del linter para fallos y filtrado de líneas. Sin bloqueantes en esta revisión; la ejecución de ese gate corresponde al responsable de entrega.

## Adjudicación del candidato final `34f4a7c`

Esta actualización conserva los hallazgos originales y distingue su resolución en código de la entrega publicada. Se verificó localmente que HEAD corresponde a `34f4a7c` y se releyó la guía de calidad corregida. Los resultados agregados siguientes los aporta el responsable del gate exacto; el autor de esta auditoría no repitió esa ejecución completa.

| Evidencia                                  | Estado del candidato                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suite principal                            | **8.310 pruebas PASS**                                                                                                                                   |
| Suite REPL separada                        | **28 pruebas PASS**                                                                                                                                      |
| Cobertura global                           | **80,01 % de sentencias; 80,73 % de líneas**                                                                                                             |
| Instalación limpia del artefacto candidato | **PASS**, comunicada por el responsable                                                                                                                  |
| Checkpoint Git heredado                    | Corrección revisada; captura y restauración ligadas a proyecto/HEAD/OID, protección de cambios ajenos y regresión de renombrado a destino ignorado       |
| Permisos de `git_branch`                   | Revisión independiente: crear/borrar ramas requiere política de mutación; listar no concede permiso de escritura                                         |
| `read_image`                               | Revisión independiente: efecto de red explícito, límite canónico del proyecto, rechazo de enlaces inseguros y propagación de cancelación a lectura y SDK |
| Guía de calidad                            | Releída y corregida; ya no confunde autorrevisión con aceptación medida                                                                                  |
| Publicación next.8                         | **Pendiente**: ejecución de Actions `35267933015`; falta confirmar publicación y consumo del paquete publicado                                           |
| Casos reales reservados                    | **Pendientes**: falta adjuntar resultados, límites y fallos                                                                                              |

Las pruebas de imagen simulan los SDK; no acreditan llamadas reales a proveedores ni un sandbox del sistema operativo. La clasificación de permisos y la protección de rutas reducen riesgos concretos, pero no convierten repositorios o herramientas externas en entornos seguros por sí mismos. La cobertura supera el umbral por un margen pequeño: sirve como evidencia del gate, no como medida de autonomía o calidad de las soluciones generadas.

**No se identifica otro bloqueante de producto reproducido y abierto en el alcance revisado.** Los problemas de documentación, cancelación de setup, checkpoint y permisos descritos quedan resueltos en el candidato revisado. La heterogeneidad editorial menor y la enumeración incompleta de proveedores en ayuda siguen siendo mejoras posteriores; no impiden el piloto supervisado. Esta conclusión no demuestra ausencia de defectos fuera de la muestra.

La recomendación permanece: **piloto supervisado en repositorios de confianza**. No se declara terminado el plan, publicada next.8 ni lista una versión estable: el cierre requiere comprobar el paquete publicado y adjudicar los casos reservados. Si estos muestran un fallo relevante, deberá registrarse y resolverse o limitarse expresamente el alcance antes de ampliar la recomendación.

## Adjudicación de cierre RC2

El candidato `5bd23ef` corrige además el falso éxito de respuestas incompletas en las tres rutas públicas del runtime y propaga cancelación a las herramientas del lote. Implementación y delta revisadas por otro agente; 74 regresiones enfocadas y gate exacto de 8337 pruebas principales +28 REPL PASS, con 80.02% statements y 80.75% líneas e instalación limpia aprobada. La evidencia original de los reservados corresponde a next.8 y conserva sus fallos. El dictamen combinado es mantener RC2 para piloto supervisado, sin promover estable: faltan perfil recomendado validado y uso práctico independiente. Estado remoto y continuidad en [el cierre actual](HANDOFF_2026-09-17.md).
