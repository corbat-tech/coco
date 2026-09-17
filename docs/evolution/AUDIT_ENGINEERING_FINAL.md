# Auditoría final de ingeniería — Coco 2.42

Fecha: 17 de septiembre de 2026. Base de revisión: candidato `7fb9aca` y correcciones de cierre posteriores que deberán volver a verificarse en su commit exacto. Este informe no acredita una publicación nueva.

## Dictamen

Coco tiene una arquitectura aprovechable para un agente de programación y para reutilizar componentes en futuros productos de Corbat. **Recomiendo un piloto local supervisado en repositorios de confianza, condicionado a cerrar los bloqueantes siguientes y pasar el gate completo del artefacto final.** No recomiendo presentarlo todavía como ejecución autónoma aislada para múltiples empresas ni como garantía de corrección de software.

La revisión encontró dos incoherencias de permisos que impiden cerrar estable con el candidato inspeccionado: operaciones mutantes de `git_branch` consideradas lectura, y análisis remoto de imágenes considerado lectura local. Se comunicaron al integrador antes de proponer cambios. Ambas se han corregido en el candidato y revisado por otro agente; las regresiones enfocadas se detallan debajo. Una prueba completa anterior a esas correcciones no las valida.

## Alcance e independencia

Es una **revisión informada de otro agente**, no ciega ni realizada por una empresa auditora externa. El revisor implementó parte de calidad, headless, contexto y checkpoints; conoce el historial. Para evitar autoacreditación, el cambio de checkpoints fue revisado además por otro agente, que encontró y reprodujo una pérdida de archivo ignorado por detección de renombrados. Esa regresión se corrigió y tiene prueba real.

En esta revisión final se inspeccionaron contratos de runtime, ejecución delegada, política de permisos, herramientas con efectos, publicación npm/VSIX, guía de calidad y límites de recuperación. Se revisaron independientemente pruebas de permisos persistidos y recuperación escritas por otro agente. No se hizo pentest, prueba de carga empresarial, inferencia nueva ni llamada a API de pago. No se ejecutaron pruebas sobre archivos personales.

## Hallazgos que bloquean el cierre

| Hallazgo                                              | Evidencia reproducible                                                                                                                                                                                                                                                                                                                    | Condición de cierre                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: `git_branch` puede cambiar Git en modo lectura    | `permission-policy.ts` incluye el nombre entre herramientas de lectura; `git.ts` acepta `create`/`delete`, y `create` invoca `checkoutLocalBranch`. En mirror aislado, `canExecuteToolInput('plan', gitBranchTool, {create: 'unapproved-branch'})` devolvió `{allowed: true, risk: 'read-only'}`. No se modificó un repositorio personal. | Clasificación según argumentos: listar puede ser lectura; crear/eliminar requiere autorización y queda prohibido en modo lectura. Probar rechazo sin invocar Git y comportamiento autorizado. Alinear descripción con el efecto real de creación/cambio de rama. |
| P1: `read_image` oculta efectos de red y credenciales | Se clasifica como `document` de lectura, pero el código crea clientes Anthropic/OpenAI y envía la imagen en base64 con credenciales del entorno. Una política que restringe riesgo de red no recibe ese riesgo. Además, la comprobación de ruta es léxica antes de `stat`/`readFile`, que siguen enlaces simbólicos.                      | Riesgo y consentimiento explícitos para la operación remota; comprobar denegación antes de leer o llamar al SDK. Validar ruta canónica para impedir enlaces que escapen del proyecto. Regresiones con SDK simulado, sin transmitir datos reales.                 |

**Resolución candidata, pendiente del gate acumulado:** `git_branch` ahora evalúa argumentos y prohíbe mutaciones en lectura incluso con confirmación; en ejecución autorizada exige consentimiento. La descripción reconoce que crear también cambia la rama activa. `read_image` exige riesgo de red y confirmación y se prohíbe en modos de lectura; comprueba ruta canónica, descriptor sin seguimiento de enlaces finales, archivo regular y un único enlace antes de leer. Los SDK reciben cancelación y se rechazan resultados tardíos. Las pruebas simulan los tres SDK; no hubo transmisión ni gasto real. Un segundo agente revisó estos cambios sin bloqueantes.

El límite de archivos de imagen está ligado al **directorio de trabajo canónico del proceso**. `ToolExecutionContext` no transporta actualmente una raíz de proyecto; un host embebido debe fijar/aislar ese directorio y no asumir aislamiento por sesión. La comprobación no es una defensa completa ante sustitución concurrente de directorios por otro proceso con los mismos permisos. No se cambia ni se certifica el catálogo/modelos de visión en esta corrección.

Registro de reproducción local: `logs/engineering-gitbranch-repro.log` bajo el directorio temporal de validación de la entrega. Es evidencia de decisión incorrecta de la política; la llamada mutante se verificó por lectura de su implementación.

## Contratos que mejoran de forma comprobable

| Área                 | Valor observado                                                                                                                                                                                                                                    | Límite                                                                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime reutilizable | `AgentRuntime` compone proveedor, herramientas, sesiones, permisos y eventos; `RuntimeToolExecutor` conserva los límites de herramientas y modos de los ancestros y no hereda confirmación a delegados.                                            | La política lógica no es un sandbox del sistema operativo. Un host que inyecta adaptadores o autoriza shell debe controlar su entorno.                                                                                                      |
| Procesos y sesiones  | Background pertenece a sesión/proyecto y tiene límites de concurrencia, tiempo y salida; el cierre elimina la capacidad de lanzar trabajos tardíos.                                                                                                | Windows permanece restringido donde no hay evidencia del cierre del árbol de procesos. No equivale a un scheduler distribuido.                                                                                                              |
| Recuperación         | `/resume` conserva configuración y autoridad del host; efectos pendientes se marcan desconocidos. Rewind contrasta postimagen y límites de proyecto/sesión. Checkpoints Git candidatos conservan staging y rechazan restaurar sobre trabajo nuevo. | No hay rollback universal. Archivos no seguidos, metadatos antiguos o estados divergentes pueden rechazarse; un fallo de aplicación Git se informa como potencialmente parcial y nunca activa limpieza destructiva.                         |
| Calidad              | Medición/no aplicable/no disponible/error separados; snapshot vinculado a evidencia; aceptación distinta de convergencia o agotamiento de presupuesto.                                                                                             | Dimensiones estáticas son heurísticas, no prueba de requisitos ni auditoría de vulnerabilidades. Solo está certificada la ruta JS/TS compatible.                                                                                            |
| Terminal/headless    | Resultado JSON controlado, entrada acotada, cancelación y cierre de runtime; actualizaciones no interrumpen el prompt.                                                                                                                             | `success` de una ejecución no demuestra corrección de la solución. Headless autorizado puede ejecutar comandos del proyecto.                                                                                                                |
| Contexto             | Presupuesto explícito, invalidación de caché y conservación de instrucciones; fallos o resúmenes truncados conservan historial.                                                                                                                    | El fingerprint de índice usa metadatos, no hash íntegro del contenido. La procedencia de resúmenes solo se reconoce en objetos de la sesión viva; historiales deserializados pueden negarse a compactar si conservarlos excede presupuesto. |
| Publicación          | Gate, build único, tarball exacto, hash/integridad, instalación limpia y reconciliación de versión inmutable; OIDC en Actions. GitHub Release depende del canal correspondiente.                                                                   | El estado remoto requiere verificación real. Empaquetar VSIX y publicarlo en GitHub no acredita publicación en Marketplace.                                                                                                                 |

## Pruebas y alcance de la evidencia

El revisor ejecutó en mirror/sandbox, con archivos temporales y sin APIs de pago:

- Skills: 20 pruebas; metadata y descubrimiento reales, subprocess simulado. Corrigieron interpolación shell, nombres que escapaban del directorio y YAML con comillas/saltos.
- MCP/model/thinking y sesión: 103 pruebas en cuatro archivos; registro MCP en disco y entrada interactiva controlada. Corrigieron valores de entorno truncados, presupuestos parciales y pérdida de `thinking: off` al guardar/aplicar.
- Checkpoints: 23 pruebas, incluidas 17 con Git real. Verifican staging/working tree, stashes ajenos, HEAD/proyecto, enlaces de metadatos, rechazo de cambios ajenos y archivos ignorados tanto añadidos como renombrados.
- Permisos e imágenes: 32 pruebas enfocadas pasan (incluidas 13 de imágenes y 6 de efectos/permisos), con los tres SDK simulados; verifican denegación antes de ejecución, contenido local autorizado y cancelación.
- Typecheck completo del mirror: aprobado en esas revisiones. Las pruebas posteriores del integrador y el gate final deben cubrir el conjunto acumulado.

Las mediciones específicas de módulos no sustituyen cobertura global: skills alcanzó 93,53% de líneas; MCP/model/thinking, 94,58% conjuntamente. El LCOV de next.6 era 19.448/27.105 líneas (71,75%). **Este informe no declara alcanzado el 80% global:** debe salir del gate final sin reducir umbrales ni añadir exclusiones.

El corpus Ollama y los casos reservados pertenecen a la evaluación del integrador. Deben distinguir código verificado, terminación del agente, agotamiento de llamadas y tiempo. No extrapolar un conjunto sintético pequeño a rendimiento general, a todos los proveedores ni a ventaja sobre otros productos.

## Revisión de la guía de calidad

La guía `docs/guides/QUALITY.md` distingue correctamente autorrevisión del LLM, `review_code` y evaluación medida. Coincide con el código en que evidencia incompleta, snapshot desactualizado y convergencia no autorizan aceptación. También reconoce configuración parcialmente consumida y registro multilenguaje no certificado.

Durante la revisión se corrigió una precisión editorial: la tabla decía «All requirements implemented» y «logic correct», garantías que las mediciones no sostienen. Ahora describe heurísticas estructurales y resultados de pruebas/compilación disponibles. También explicita seguridad 100 y ausencia de hallazgos críticos como requisitos de aceptación. Se comprobó que esos límites coinciden con el evaluador.

## Arquitectura y siguientes decisiones

Mantener Coco como producto de programación en TypeScript y evolucionar contratos existentes tiene más justificación que migrarlo a Python o introducir otro framework durante este cierre. La frontera runtime/adaptadores permite desarrollar un agente empresarial posterior con herramientas y políticas específicas sin convertir Coco en una plataforma universal ahora.

La escalabilidad pendiente es operativa: aislamiento de proyectos/credenciales, controles del host, cancelación consistente y métricas de resultados. No conviene añadir más agentes, colas o capas de abstracción antes de demostrar una necesidad de concurrencia y un modelo de autoridad verificable. La reutilización de runtime es una base; no prueba por sí sola multitenancy seguro.

## Criterio de promoción

1. Corregir y revisar los hallazgos P1 de esta auditoría; mantener pruebas que impidan recaídas.
2. Aprobar typecheck, lint, formato, suite principal con cobertura acordada, integración REPL y build sobre el commit exacto.
3. Ejecutar casos Ollama reales reservados con verificadores independientes y resultado honesto, incluida continuidad y recuperación.
4. Probar el paquete instalado, publicar el mismo artefacto y contrastar integridad/canal. No declarar publicado por una subida pendiente.
5. Mantener límites visibles en README/guías. Si falla cualquiera de estas condiciones, conservar preview/RC y el bloqueo documentado.

Con esas condiciones satisfechas, una entrega estable para uso local supervisado es razonable. Certificar autonomía desatendida, seguridad empresarial o superioridad frente a otros agentes exige evidencia adicional.

## Adjudicación del integrador sobre el candidato exacto

`34f4a7c` incorpora ambos P1 y sus revisiones. El gate acumulado se ejecutó sobre ese commit:8310 pruebas principales+28 REPL PASS (15 omitidas), typecheck/lint/formato/build PASS;80.01% statements y80.73% líneas. Instalación limpia del tarball local y smoke PASS. Se cierra el pendiente de regresión acumulada; publicación y casos reservados aún pendientes en este registro. El alcance y los límites de aislamiento de esta auditoría permanecen sin cambios.

## Adjudicación de cierre RC2

El candidato `5bd23ef` corrige además el falso éxito de respuestas incompletas en las tres rutas públicas del runtime y propaga cancelación a las herramientas del lote. Implementación y delta revisadas por otro agente; 74 regresiones enfocadas y gate exacto de 8337 pruebas principales +28 REPL PASS, con 80.02% statements y 80.75% líneas e instalación limpia aprobada. La evidencia original de los reservados corresponde a next.8 y conserva sus fallos. El dictamen combinado es mantener RC2 para piloto supervisado, sin promover estable: faltan perfil recomendado validado y uso práctico independiente. Estado remoto y continuidad en [el cierre actual](HANDOFF_2026-09-17.md).
