# Coco, OpenCode, Aider y Devin: comparación de producto

Consulta de fuentes primarias: 17 de septiembre de 2026. Coco se compara como **resultado previsto de la entrega**, no como versión ya publicada. Las capacidades de otros productos proceden de documentación oficial; no se ejecutó un benchmark comparativo ni se midieron tasas de resolución, velocidad o coste. Esta revisión conoce el contexto de Coco y no es una evaluación ciega.

| Producto | Flujo y encaje | Diferencia relevante para Coco |
| --- | --- | --- |
| Coco previsto | Programación supervisada en CLI, herramientas, proveedores, recuperación conservadora y runtime reutilizable para Corbat. | Necesita demostrar resultados reproducibles y una experiencia coherente; no acreditar autonomía mediante puntuaciones del modelo. |
| OpenCode | Agente abierto con terminal, desktop, IDE, agentes Build/Plan y subagentes. | Referencia para interacción, permisos por agente e integración del ciclo de desarrollo. |
| Aider | Colaboración incremental: preguntar, editar, revisar diferencias, ejecutar lint/tests y gestionar cambios con Git. | Referencia para un recorrido simple y validación después de editar. |
| Devin | Producto comercial propietario con delegación remota, entorno de ejecución, navegador e intervención humana. | Su infraestructura operativa y empresarial constituye un alcance bastante mayor; no es otro repositorio abierto que copiar. |

## OpenCode

La [introducción oficial](https://opencode.ai/en/docs) documenta terminal, aplicación desktop y extensión IDE. Los [agentes](https://opencode.ai/docs/agents) permiten separar construcción, planificación y especialización con modelos/permisos propios.

Los [permisos](https://opencode.ai/docs/permissions/) tienen defaults mayoritariamente permisivos y excepciones para `.env`, acceso exterior y bucles. Esto no acredita aislamiento del sistema operativo. Existen documentos `/v2/docs/` con una superficie distinta: no mezclar sus reglas con la documentación principal.

La [integración GitHub](https://opencode.ai/docs/github/) ejecuta tareas en Actions y soporta comentarios, issues, PR y ejecuciones programadas/manuales. También se documentan [servidor/API](https://opencode.ai/docs/server/) y [Enterprise](https://opencode.ai/docs/enterprise/), con configuración central, SSO y gateway interno. Compartir sesiones es una función separada con implicaciones de envío de datos.

**Inferencia de producto:** es el referente más cercano para evolucionar la experiencia general de Coco. La amplitud de integraciones no demuestra una mayor tasa de soluciones correctas.

## Aider

El [repositorio oficial](https://github.com/Aider-AI/aider) publica licencia Apache-2.0. Sus [modos](https://aider.chat/docs/usage/modes.html) distinguen `ask`, `code` y `architect`; este último separa propuesta y edición entre modelos.

El flujo de [lint y tests](https://aider.chat/docs/usage/lint-test.html) ejecuta lint tras editar y permite tests automáticos configurando `--test-cmd` y `--auto-test`. Los fallos de comandos alimentan el siguiente intento. Su [integración Git](https://aider.chat/docs/git.html) puede realizar commits automáticos y guardar cambios preexistentes antes de editar; se puede desactivar. No equivale a la recuperación no mutante de Coco.

El [mapa del repositorio](https://aider.chat/docs/repomap.html) selecciona contexto dentro de un presupuesto. El [scripting](https://aider.chat/docs/scripting.html) permite tareas CLI; la documentación advierte que la API Python no ofrece garantía de compatibilidad.

**Inferencia de producto:** copiar la claridad de pasos pequeños y el circuito edición–verificación aporta más valor inmediato que añadir un nuevo framework. No se deduce de estas fuentes que Aider sea una plataforma de sesiones empresariales remotas.

## Devin

La [documentación del producto](https://docs.devin.ai/get-started/devin-intro) presenta shell, IDE y navegador, con supervisión/intervención humana. Actualmente también documenta CLI local y `/handoff` a cloud. Sus [condiciones de plataforma](https://cognition.com/legal/platform-terms-of-service) corresponden a un servicio comercial propietario; no debe etiquetarse como proyecto abierto.

Las [herramientas de sesión](https://docs.devin.ai/work-with-devin/devin-session-tools) y [pruebas con grabaciones](https://docs.devin.ai/work-with-devin/testing-and-recordings) describen una experiencia de ejecución y revisión visual más amplia que una CLI que invoca tests.

Los [perfiles de seguridad](https://docs.devin.ai/product-guides/security-profiles) abarcan red, MCP y Git con restricciones heredadas por organizaciones, automatizaciones y sesiones. La propia documentación distingue las VM administradas de Outposts: en estos últimos, aplicar las restricciones de red corresponde al operador de la infraestructura.

**Inferencia de producto:** sirve de referencia para una futura oferta empresarial de Corbat. Replicar ahora toda su plataforma sería un cambio de alcance; disponer de shell, permisos y sesiones en Coco no demuestra equivalencia.

## Qué trasladar a Coco y cómo comparar resultados

1. De Aider: comandos de validación reales, contexto acotado y diferencias fáciles de revisar.
2. De OpenCode: selección clara de modo/agente, permisos comprensibles y buen recorrido terminal/IDE/CI.
3. De Devin: claridad de entrega, evidencia de pruebas y separación de permisos empresariales; infraestructura remota solo ante demanda concreta.

Para comparar resultados se necesitan tareas reservadas iguales, entorno reproducible, modelos y presupuestos registrados, criterios de aceptación externos y resultados con fallos incluidos. Hasta disponer de ello no procede publicar una nota global de calidad ni porcentajes de superioridad. Mantener Coco centrado en programación y su runtime como base reutilizable es compatible con construir agentes específicos para empresas más adelante.
