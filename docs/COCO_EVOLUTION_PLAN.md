# Coco: evolución pragmática y entregas progresivas

Fecha: 2026-09-16. Estado: **implementación en curso; E05 activo**.
Base inspeccionada: `174fc4128bc190fe0cb0b581d2153b805c49f4af`, paquete `2.41.0`.

Este es el plan vigente para esta evolución. Sustituye **la secuencia de ejecución**, no la evidencia, del plan de 39 pasos de la [auditoría del 16 de septiembre](../../corbat-coco-auditoria/2026-09-16/public/04-plan-de-progreso.md). La auditoría permanece como snapshot histórico fuera del repositorio; su enlace requiere el directorio hermano. Los IDs COCO y S remiten a ese snapshot. [MASTER_PLAN.md](MASTER_PLAN.md) y [CODEX_IMPROVEMENTS_PLAN.md](CODEX_IMPROVEMENTS_PLAN.md) son antecedentes, no listas adicionales que completar antes de publicar. Mandan [CLAUDE.md](../CLAUDE.md) y los ADR aceptados.

## 1. Decisión: sí merece la pena, con menos alcance obligatorio

Corregir falsos éxitos, permisos inconsistentes, cancelación incompleta y publicaciones aparentemente correctas tiene valor directo. Sin embargo, una auditoría estática no demuestra todavía cuánto mejorará Coco resolviendo tareas. La mejora se comprobará con tareas reales, diffs y pruebas independientes, no con número de funcionalidades ni con la puntuación que se atribuya el propio agente.

El plan anterior tiene buen diagnóstico y criterios de prueba, pero retrasa el feedback: evals en S35, frontera compartida en S38 y releases dependientes de completar build/resume clásicos. También mezcla un agente local con una plataforma pública. No debe ejecutarse como 39 requisitos consecutivos.

**Producto prioritario:** agente CLI/REPL para trabajar en repositorios existentes, con control humano de efectos, progreso legible y resultado verificable. Headless y extensión son adaptadores; los starters siguen siendo demos locales. El runtime continúa reutilizable, sin convertir esta mejora en un programa de plataforma multiusuario.

**Decisión de alcance confirmada:** Coco sigue siendo un agente de programación en TypeScript. No se migra a Python ni se incorporan FastAPI/LangGraph en este programa. Los futuros agentes empresariales de Corbat son otra iniciativa; cualquier extracción compartida se justificará por un consumidor real. Esta decisión confirma la arquitectura del plan y no cambia el orden E01–E14.

**Resultado buscado:** pedir un cambio → obtener un plan proporcionado → editar dentro del alcance → probar → revisar el diff → corregir → continuar o recuperar el trabajo, sin perder cambios ajenos ni declarar éxito sin evidencia. La revisión independiente obligatoria de cada incremento de desarrollo no implica ejecutar varios agentes en cada turno del producto.

## 2. Arquitectura: consolidar lo existente

Se conserva el monolito modular TypeScript/ESM y el sentido de los [ADR 009](architecture/adrs/009-multi-agent-runtime-contracts.md) y [010](architecture/adrs/010-reference-grade-multi-agent-runtime.md). No se añade un framework de agentes, otro scheduler ni otro runtime.

| Responsabilidad | Base existente y decisión |
| --- | --- |
| Interacción | CLI/REPL, headless y extensión presentan entradas, progreso, aprobaciones y resultados. Evitar decisiones de permisos distintas por interfaz. |
| Turnos y contratos | Reutilizar `src/runtime/` y los bucles existentes mediante adaptadores. Primero compartir ejecución de herramientas; migrar un bucle solo con pruebas de paridad. |
| Política y efectos | Un punto compartido de autorización y ejecución, sobre `RuntimeToolExecutor`, consumido por REPL y runtime. El registry conserva catálogo/validación/invocación; no decide otra política independiente. |
| Proveedores | Conservar adaptadores y matriz de capacidades. Normalizar errores, cancelación, finales de stream y schemas en esas fronteras. |
| Sesiones y recuperación | Reutilizar stores, event log y CheckpointManager. Versionar lo necesario; no añadir una segunda base de datos o un nuevo sistema de event sourcing. |
| Contexto | Mejorar `repo_context` y su índice/cache existentes con presupuesto de tokens e invalidación medidos. No reconstruir un repo map desde cero. |
| Orquestación | Mantener los contratos multiagente aceptados. Un escritor por workspace como comportamiento base; paralelismo de lecturas acotado y revisores separados cuando aporten valor. |

### Restricciones de diseño que evitan una reescritura

- `AgentRuntime` no sustituye hoy todo el REPL: su runner por defecto hace chat de texto; el runner de tools es otra opción. No eliminar streaming, hooks, steering, permisos o recuperación al mover llamadas.
- `ParallelToolExecutor` llama a `registry.execute`; el test de arquitectura actual busca el literal `toolRegistry.execute` y no detecta ese alias. Caracterizar todas las entradas y reforzar la comprobación semántica y las pruebas de integración antes de declarar una frontera única. No basta renombrar variables para pasar el test.
- Consolidar las rutas duplicadas de `AgentRuntime.executeTool` y `RuntimeToolExecutor`; extender el contexto compatible de ejecución con señal/deadline/identidad según sea necesario. No obligar a todas las tools a adoptar un framework nuevo.
- La autorización de rutas debe cubrir tools y escrituras directas de COMPLETE. El shell puede ejecutar cualquier programa: un validador de rutas o un worktree **no equivale a un sandbox**. La primera versión se presenta como ejecución local de confianza, con aprobación conservadora. Antes de anunciar ejecución autónoma de contenido no confiable, demostrar confinamiento real con un backend existente y su matriz de plataformas; no inventar un sandbox multiplataforma en esta fase.
- Un timeout no prueba que una mutación remota haya sido deshecha. Usar estado de efecto incierto y reconciliación; no reintentar automáticamente escrituras de resultado desconocido.
- Cada extracción responde a una duplicación o fallo observado y deja adaptadores compatibles. Si cambia una decisión aceptada, añadir un ADR breve que explique ese cambio; no crear documentación paralela contradictoria.

### Escalabilidad que sí importa ahora

Acotar concurrencia, memoria durante stdout/stderr, tamaño y retención de logs, contexto por turno, sesiones y conexiones MCP. Medir arranque sin red, repositorios grandes y sesiones largas. Reutilizar las capacidades ya existentes de plataforma sin ampliarlas por anticipación. Distribución, multi-tenancy público, más infraestructura PostgreSQL/RAG y ejecuciones especulativas Best-of-N quedan condicionadas a una carga o necesidad demostrada.

## 3. Qué adaptar de otros agentes

Las fuentes son documentación primaria y archivos concretos inspeccionados; no se han ejecutado benchmarks comparativos de esos productos. Los hashes y licencias raíz se consultaron el 2026-09-16. Esta tabla propone adaptaciones; no afirma que Coco ya las haya implementado.

| Referencia | Qué aprovechar | Aplicación y criterio de entrada |
| --- | --- | --- |
| [Codex: aprobaciones y sandbox](https://learn.chatgpt.com/docs/agent-approvals-security) | Separar autorización de confinamiento del proceso. | E03–E05: misma política en cada entrada; no vender comprobaciones de rutas como aislamiento del SO. |
| [Codex no interactivo](https://learn.chatgpt.com/docs/non-interactive-mode) | Separar progreso, resultado final y eventos para automatización. | E11: corregir primero el JSON actual. JSONL sería un formato adicional explícito y versionado, sin romper consumidores actuales. |
| [Codex apply_patch, Apache-2.0](https://github.com/openai/codex/blob/4701aa4b4239c70063ab6f2fcb835324f9c109f4/codex-rs/core/src/tools/handlers/apply_patch.rs) | Parsear y verificar el parche antes de ejecutar sus efectos. | C01, solo si los fallos de edición lo justifican: aprovechar herramientas existentes y probar conflictos/estado esperado. No portar el motor Rust. |
| [OpenCode truncate, MIT raíz](https://github.com/anomalyco/opencode/blob/501ff62cbf40d4ff260b48c9f1fc113e9b9a83e1/packages/opencode/src/tool/truncate.ts) | Preview acotada más referencia al resultado completo. | E07: adaptar el protocolo; su truncado de una cadena completa no resuelve por sí solo la memoria durante streaming. No importar Effect para esta utilidad. |
| [OpenCode permisos](https://opencode.ai/docs/permissions/) | Decisiones allow/ask/deny por herramienta/recurso. | E03–E05: extender la política que ya tiene Coco, sin otro motor de permisos. |
| [pi agent-loop, MIT raíz](https://github.com/badlogic/pi-mono/blob/6671c604766b3670ed95f405aa7856835d0ca702/packages/agent/src/agent-loop.ts) | Señal de cancelación en el ciclo, steering en puntos definidos y rechazo de tool calls de respuestas truncadas. | E07/E12: nunca ejecutar argumentos de escritura recuperados de una respuesta incompleta. Caracterizar primero el steering que ya existe en Coco. |
| [Aider repo map](https://aider.chat/docs/repomap.html) | Contexto estructural priorizado dentro de un presupuesto de tokens. | E13: el índice de Coco ya puntúa imports, símbolos y tests; su presupuesto actual cuenta archivos. Mejorar esa diferencia y medir, sin duplicar el índice. Referencia documental; no se ha revisado su implementación completa. |
| [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Elegir el flujo más sencillo que resuelve el problema y añadir complejidad cuando se justifica. | Una tarea y un ciclo verificable por defecto. No convertir todo en DAG o delegación automática. |

**Reutilización de código:** preferir patrones y tests de comportamiento. Si se copia un fragmento, registrar repositorio, archivo, SHA, licencia aplicable al archivo, atribución/NOTICE cuando proceda, cambios y pruebas. Las licencias raíz MIT/Apache-2.0 no sustituyen comprobar cada archivo y dependencia. No copiar prompts íntegros ni incorporar paquetes completos para una función pequeña.

## 4. Secuencia de implementación

Cada fila es una **unidad de resultado**, no necesariamente un commit. Al activarla, dividir sus comportamientos independientes en E04.a, E04.b, etc. Cada subpaso tiene pruebas, revisión y commit propios. No integrar un macrocommit con toda una entrega. Un solo subpaso en implementación a la vez; una investigación independiente puede avanzar en paralelo.

Estados iniciales documentados: todos TODO. La ejecución actual y sus pruebas se registran en la sección 9. Los hallazgos estáticos deben revalidarse sobre el checkout antes de corregirlos.

### Entrega A · Poder medir y publicar con confianza

| ID / estado | Cambio y dependencias | Aceptación mínima |
| --- | --- | --- |
| E01 / DONE | Baseline del checkout y 3–5 tareas pequeñas sobre el REPL **existente**. Sin depender del CLI build/resume clásico. | Entorno/commit/lockfile, checks reales, fallos previos y superficies soportadas registrados. Inventario P0/P1 por superficie con evidencia de corrección, contención o bloqueo de release; no basta marcar una función como legacy. Fixtures con bug, feature y fallo/recuperación; pruebas verifican resultado y efectos, no solo texto. Distinguir replay hermético de capacidad con modelo real. |
| E02 / DONE | CI y puerta de publicación. Depende E01. Subpasos: suite REPL/e2e; checks por canal; paquete instalado; fallo de publicación. | Reparar script e2e o retirar su promesa hasta disponer de pruebas; REPL corre aparte; fallo de publish no se convierte en éxito; tarball instalado en directorio limpio ejecuta entrypoints y una tarea con provider fixture. Gate se prueba sin publicar. |

Desde esta entrega se pueden preparar candidatos, pero no publicar como estable superficies con defectos graves conocidos sin contener. No esperar a terminar todo el programa para corregir el mecanismo de release.

### Entrega B · Efectos controlados y resultados honestos

| ID / estado | Cambio y dependencias | Aceptación mínima |
| --- | --- | --- |
| E03 / DONE | Caracterizar y unificar la frontera de tools. Depende E01. Compartir política/ejecución antes de extenderla. | Misma matriz de permisos desde REPL, headless, runtime y delegación; hooks, concurrencia de lecturas, confirmaciones y errores conservados. Detectar bypass con alias; sin doble ejecución ni doble aprobación. |
| E04 / DONE | Rutas, COMPLETE, shell y undo. Depende E03. Separar integración de file tools, generación y shell/undo en subpasos. | Traversal, symlinks, padre symlink, sibling-prefix y rutas externas; validar acción antes de mutar. Composición/redirección no hereda permiso por primera palabra o sufijo help. Undo sin interpolación shell ni pérdida de cambios previos/staged/ajenos. |
| E05 / DONE | Permisos MCP y autoridad delegada. Depende E03–E04. | Tools remotas desconocidas no se consideran lecturas seguras; modo plan no muta. Hijo recibe concesión acotada del padre, nunca `confirmed=true` universal; rol docs coherente y resultados estructurados, sin `[object Object]`. |
| E06 / IN_PROGRESS | Contener promesas y superficies incompletas. Depende E01; puede adelantarse como parche. | Build/resume clásicos sin éxito simulado; mensajes y exit codes honestos. Starter loopback, límites de body y errores controlados; no soporte público anunciado. Quality gates no permiten éxito con medición ausente o crítico: corregir o deshabilitar explícitamente esa salida mientras E09 se completa. Ayuda no recomienda funciones retiradas. |
| E07 / TODO | Cancelación, buffers y coherencia de streams. Depende E03. Subpasos independientes: señal; procesos/red; cuotas; stream final. | Abort llega a la tool/proceso/hijos y libera timers/listeners. Límites durante streaming y en disco, preview head/tail legible. Sin mezcla de proveedores tras primer chunk, retry de mutación incierta ni ejecución de tool call truncada; Ctrl+C tiene estado veraz. |

**Release B:** una o varias versiones de corrección según alcance. Para una versión estable, cada P0/P1 revalidado en el artefacto/superficie publicada está resuelto o contenido de forma comprobable; deshabilitar una función exige actualizar ayuda y compatibilidad, no esconder el riesgo. No es obligatorio terminar todas las mejoras de UX ni recuperar flujos antiguos. E02 y la matriz de release de la sección 7 son obligatorios.

### Entrega C · Fiabilidad de uso diario

| ID / estado | Cambio y dependencias | Aceptación mínima |
| --- | --- | --- |
| E08 / TODO | Schemas fieles en registry/proveedores/MCP. Depende E03. Puede adelantarse tras E03. | Payloads nested/union/record/default/constraints y descripciones contrastados con validación real. Evaluar primero conversión de Zod ya instalado; probar subconjunto aceptado por cada adaptador. No añadir otro framework de schemas. |
| E09 / TODO | Calidad y aceptación del contenido final. Depende E01 y contención E06. | Una regla para todas las salidas; passed separado de converged. Medición real/error/no disponible, pesos efectivos; nunca score perfecto por dato ausente. Snapshot/hash del resultado coincide con tests/revisión; última iteración no añade una mejora sin verificar. Políticas distintas se explicitan sin rebajar CLAUDE. |
| E10 / TODO | Sesión y recuperación conservadora. Depende E04/E07; integración de quality rollback después de E09. | Identidad de sesión estable; aislamiento por proyecto. Reusar CheckpointManager y conectar rewind/estado correcto; conflicto si cambió contenido desde snapshot, preservar staged/untracked/cambios ajenos. Resume no repite efectos completados. No prometer rollback universal de shell o MCP. |
| E11 / TODO | Headless y extensión. Depende E02/E04; esquemas de respuesta coherentes con E08. | Entrada vacía, opción inválida y error producen contrato JSON y exit code correctos, sin ruido stdout. Extensión usa ejecutable/argv seguro, espacios/comillas/multiroot y binario ausente probados. VSIX tiene gate propio; no bloquea npm si no se publica ese canal. |
| E12 / TODO | Fluidez y estilo del terminal. Arranque/ayuda dependen E01/E06; estados finales de E07/E10/E11. | Primer input no espera al update de red. Mensajes consistentes: trabajando, esperando permiso, cancelado, fallido, completado con evidencia; resumen con diff/checks/siguiente acción. Comprobar 40/80/120 columnas, resize/paste/Unicode/NO_COLOR/no TTY. Verificar steering existente antes de cambiarlo. Sin rediseño integral de TUI. |

### Actualización de modelos y contratos API · incorporada durante E05

Petición del usuario: mantener los modelos actuales y actualizar su compatibilidad; valorar incorporaciones de uso extendido reciente cuando aporten utilidad al agente de programación. No migrar de framework ni ampliar proveedores solo para aumentar el catálogo.

- [ ] **E07 · transporte:** revisar documentación oficial vigente de cada proveedor integrado al implementar streaming, cancelación, timeouts y reintentos. Registrar URL, fecha de consulta, versión de SDK/API y diferencias relevantes; no asumir compatibilidad por compartir una API parecida.
- [ ] **E08.a · inventario y compatibilidad:** inventariar IDs/aliases actuales, endpoints y versiones; comprobar mensajes y roles, system/developer, resultados e IDs de tools, schemas admitidos, parámetros de tokens/reasoning/temperatura, límites y errores. Construir una matriz por modelo o familia cuando haya diferencias documentadas. Conservar configuraciones y modelos actuales; si el proveedor retira uno, comunicar indisponibilidad y alternativa sin sustitución silenciosa.
- [ ] **E08.b · adaptadores:** corregir payloads y parsing por capacidades verificadas, incluidos tool calls en streaming, finalización y uso reportado. Probar contratos con fixtures fieles, errores y regresiones de modelos existentes. Omitir parámetros incompatibles; no enviar campos nuevos indiscriminadamente a todos los modelos. Commits pequeños con revisión independiente.
- [ ] **E13 · candidatos y evaluación:** consultar fuentes oficiales actuales y evidencia de adopción al seleccionar modelos adicionales; priorizar proveedores ya integrados. Añadir solo candidatos con utilidad concreta y mantenimiento proporcionado. Comparar resolución de tareas, fiabilidad de tools, latencia y coste con el corpus existente, separando cambio de modelo de cambios de prompt. Mantener modelos existentes y no cambiar el predeterminado sin evidencia. Pruebas reales sujetas a credenciales y presupuesto acordado; marcar pendientes si faltan.
- [ ] **E14 · verificación de release:** repetir el recorrido instalado para combinaciones representativas afectadas, documentar modelos probados, compatibilidad no verificada y fecha de revisión. Dejar un procedimiento de actualización por cambios de proveedor, sin crear infraestructura adicional innecesaria.

Esta ampliación está **pendiente**: documentarla no acredita haber actualizado modelos o verificado APIs. Se ejecutará en los pasos indicados, manteniendo E05 como paso activo.

**Release C:** publicar mejoras listas por separado; no esperar E12 para entregar una corrección de schemas. Cada candidato vuelve a validar regresiones de la frontera que toca, y cada nueva versión publicada tiene smoke instalado. Si una capacidad de recuperación se mantiene pendiente, el producto lo declara y evita descartes destructivos.

### Entrega D · Mejor resolución de tareas, demostrada

| ID / estado | Cambio y dependencias | Aceptación mínima |
| --- | --- | --- |
| E13 / TODO | Contexto, catálogo de tools y prompts selectivos. Depende E01/E08; sesión y buffers de E07/E10 para casos largos. Cambiar una variable por experimento. | Presupuesto de tokens sobre índice existente, cache invalidada al cambiar archivos, descubrimiento de tools fuera del catálogo inicial. Compaction conserva objetivo, restricciones, decisiones y referencias verificables; contenido del repo/tools no amplía autoridad. Comparación en mismas tareas/configuración sin regresión material. |
| E14 / TODO | Cierre del ciclo de producto y deuda justificada. Depende de las capacidades efectivamente incluidas en la release, no de todo el backlog. | Recorrido instalado pedir→editar→probar→revisar→recuperar; resultados baseline/candidato publicados con límites. Revisar exclusiones de cobertura y acercar pisos a 80% con pruebas de riesgo. Retirar duplicación solo donde ya hay paridad; informe de pendientes y decisión de siguiente inversión. |

**Release D:** introducir solo cambios que mejoren un fallo reproducible, éxito de tareas, uso de contexto o fluidez medidos, manteniendo controles. Si un experimento no mejora, descartarlo/revertirlo y registrar el resultado; no conservarlo por haberlo desarrollado.

## 5. Backlog condicionado: no bloquea la primera mejora útil

| ID | Capacidad | Condición de entrada y límite |
| --- | --- | --- |
| C01 | Parches verificados / edición más robusta | Evals detectan conflictos, ediciones ambiguas o coste repetido de reemplazo. Primero mejorar la tool de edición existente. Probar estado esperado, conflicto, cambios parciales y recuperación. |
| C02 | Completar CLI COCO build/resume y dependencias entre sprints | Hay necesidad real del flujo largo, distinta del REPL. Mientras tanto E06 retira éxito simulado y E10 corrige recuperación soportada. No redirigir comandos a flujos de semántica diferente sin migración explícita. |
| C03 | Worktrees paralelos / Best-of-N | Tareas independientes y evidencia de ganancia suficiente frente al coste. Antes: single writer, permisos heredados, cancelación, integración/conflictos y presupuesto. Un worktree no es un sandbox. |
| C04 | Ejecución aislada de repositorios no confiables | Requisito concreto; evaluar backend existente, disponibilidad por SO, filesystem/red/procesos y escapes. Hasta entonces alcance local de confianza, sin claim de confinamiento fuerte. |
| C05 | Hosted/multiusuario | Usuarios y destino de despliegue definidos; ownership autenticado, límites, tenant isolation y operación. No exponer demos actuales como servicio. |
| C06 | Eventos JSONL públicos | Consumidor de CI/IDE necesita progreso incremental. Añadir formato explícito manteniendo JSON actual, eventos versionados y pruebas de consumidores. |

No se incorporan ahora marketplace, bot GitHub, nuevo framework de agentes, más proveedores por catálogo, memoria vectorial nueva o infraestructura distribuida. Reevaluar tras E14 con evidencia; esto no exige eliminar módulos existentes sin revisar consumidores.

## 6. Medición mínima y revisión por incremento

E01 establece un corpus inicial pequeño, versionado y ejecutable contra el REPL actual: bug con regresión, feature con aceptación y fallo/cancelación; añadir refactor y sesión larga cuando haya infraestructura para medirlos. Verificadores externos al agente comprueban tests y archivos; un mensaje «done» no vale. Mantener los tres replays actuales como tests de protocolo, separados del éxito de tareas con modelo real.

Registrar por caso: commit de Coco/fixture, modelo y configuración, resultado de checks, efectos no autorizados, llamadas inválidas, tiempo, tokens/coste cuando estén disponibles y número de intervenciones. Comparar baseline y candidato en condiciones equivalentes; para variabilidad repetir casos y conservar dispersión, sin presentar 3–5 casos como benchmark representativo. Añadir casos reservados antes de optimizar prompts; no entrenar contra todos los verificadores visibles. Sin credenciales/presupuesto acordado, ejecutar fixtures herméticos y marcar capacidad con modelo real **pendiente**, sin inventar mejoras.

Gates universales: cero escrituras fuera del alcance en fixtures; cero falsos éxitos en casos negativos; tests de aceptación y regresión pertinentes verdes. Congelar objetivos de tiempo/tokens y tolerancias de variabilidad después de medir baseline y antes del experimento. No inventar porcentajes de mejora a priori.

### Ciclo obligatorio de cada subpaso

1. Releer progreso, Git y guía; confirmar que el hallazgo sigue presente. Elegir un comportamiento y dependencias satisfechas.
2. Registrar criterio de aceptación y caso que reproduce el fallo, o caracterización si es refactor. Cambiar lo mínimo; dividir si mezcla resultados independientes.
3. Ejecutar pruebas focalizadas. En fronteras compartidas ejecutar suites de consumidores afectadas; reservar matriz global para candidato. No escribir tests que solo reflejan la implementación.
4. **Otro agente que no implementó** inspecciona diff exacto, código relacionado, pruebas/logs y efectos. Entregar contexto separado y registrar identidad/snapshot. Es independencia de implementación, no garantía de otro proveedor/modelo.
5. Corregir defectos materiales y revalidar el diff final; mejoras fuera de alcance van al backlog con motivo. No avanzar con objeciones materiales pendientes ni bajar umbrales para aprobar. Tras dos ciclos fallidos, reducir alcance/revisar diseño.
6. Crear commit conventional del incremento revisado y registrar hash/evidencia. La instrucción del usuario autoriza commits progresivos: no pedir confirmación en cada uno. Solo integrar cambios propios; conservar trabajo previo del usuario. Si el árbol cambia tras revisión, revisar el nuevo diff antes del commit.
7. Actualizar este progreso y pasar al siguiente subpaso preparado. En un límite de release aplicar sección 7 y publicar cuando los gates y el canal lo permitan; no esperar a terminar todo el backlog.

Estados: TODO → IN_PROGRESS → IN_REVIEW → DONE; CHANGES_REQUESTED devuelve a implementación. BLOCKED requiere causa y acción concreta. El progreso/documentación puede ir en el mismo commit revisado o en un commit documental posterior que registra el hash, evitando autorreferencias imposibles.

## 7. Commits y releases: terminar implica entregar

En Coco, «deploy» significa primero publicar el paquete CLI y su release; VSIX es otro canal. No hay un destino hosted autorizado por este plan. Esta revisión solo prepara el plan; no ejecuta publicaciones. En la ejecución posterior se continúa hasta publicar los incrementos aptos en los canales existentes y autorizados, sin pedir permiso repetido por cada commit/release. Si falta destino o credencial imprescindible, preparar el artefacto y explicar el bloqueo concreto.

**Atención al mecanismo actual:** `.github/workflows/release.yml` publica al recibir tags `v*`. No crear/pushear tags de ensayo ni asumir que un prerelease usará `next`: ese canal y su enrutamiento deben implementarse y verificarse en E02 antes de utilizarlo.

### Gate por candidato y canal

1. Elegir versión conforme a compatibilidad y estado real de tags/registro; changelog con comportamiento y limitaciones. No fijar hoy números de versiones futuros. Confirmar commit exacto, árbol limpio del artefacto y revisión independiente vigente.
2. Ejecutar typecheck, lint, format, build y suites pertinentes; en candidato npm incluir suite principal y REPL, gate de release, corpus hermético y smoke instalado. Comprobar cobertura y exclusiones reales. Respetar el objetivo 80% de CLAUDE; no ocultar ni rebajar pisos. La deuda global preexistente se registra y planifica, sin afirmar que se alcanza 80% ni convertirla automáticamente en bloqueo de todo parche crítico. Fallos que afectan al cambio o una garantía publicada sí bloquean.
3. Para apps o VSIX incluidos, typecheck/build y smoke propios. Un canal omitido figura como no publicado; un canal intentado y fallido figura como fallido. No convertir `continue-on-error` en éxito ni marcar la release completa si falta un canal prometido.
4. Empaquetar una vez y probar el tarball/VSIX exacto en entorno limpio. Registrar hash y manifest; revisar archivos incluidos y ausencia de secretos. El `prepublishOnly` actual reconstruye: E02 debe evitar publicar un build distinto del probado, publicando el artefacto verificado o comprobando identidad tras el lifecycle.
5. Usar prerelease/dist-tag de prueba cuando esté implementado. Smoke del artefacto descargado del registro; promover el mismo artefacto verificado cuando aplique, sin recompilar silenciosamente. El tag Git debe señalar el commit validado y el workflow debe repetir/verificar los gates antes del efecto de publicación.
6. Registrar npm/GitHub/VSIX por separado: versión, URL, commit, hash, resultado y fecha. Si falla un canal, diagnosticar y reintentar solo lo pendiente de forma idempotente; no volver a publicar a ciegas una versión inmutable.
7. Recuperación: instalar versión anterior conocida; si corresponde, revertir dist-tag a versión verificada y publicar parche correctivo. No reescribir tags/releases o versiones ya distribuidas para ocultar un fallo. Documentar pasos específicos antes de publicar.

Comandos existentes a verificar en E01/E02: `pnpm typecheck`, `pnpm lint`, `pnpm format` (check), `pnpm test`, `pnpm exec vitest run --config vitest.repl.config.ts`, `pnpm build`, `pnpm test:coverage`, `pnpm check:release`, `pnpm typecheck:apps`. `pnpm test:e2e` apunta actualmente a una configuración ausente: no contarlo como cobertura e2e. Revisar efectos y usar fixtures aislados antes de lanzar suites. No hacen falta todos los comandos por cada edición documental o microcambio.

## 8. Trazabilidad: nada crítico desaparece al reducir el plan

Los 14 resultados sustituyen el orden de los 39 pasos; no se finge haber reducido a 14 commits. La reducción real es retirar implementaciones opcionales de la ruta obligatoria, reutilizar capacidades y publicar antes.

| Pasos anteriores | Hallazgos | Destino y decisión |
| --- | --- | --- |
| S01, S27–S29 | COCO-16, 17 | E01/E02 y E14: baseline/REPL/release temprano; cobertura progresiva con deuda visible. |
| S02, S19–S20 | COCO-01 | E06 contiene; C02 condiciona completar CLI clásico. |
| S03–S07 | COCO-02, 03 | E03/E04; incluye COMPLETE y undo, no solo file tools. |
| S08–S09 | COCO-04, 11 | E05; concesiones heredadas y resultados estructurados. |
| S10–S11, S23–S24 | COCO-05, 14, 15 | E07; incluye llamadas truncadas y efectos inciertos. |
| S12–S15 | COCO-06, 07, 09 | E06 contiene falsos éxitos; E09 corrige medición/gates/contenido final. |
| S16–S17, S22 | COCO-08, 13 | E10, limitado a recuperación soportada; estado de fases correcto si se mantienen expuestas. |
| S18 | COCO-10 | C02: dependencias entre sprints al mantener ese flujo; si sigue accesible, corregir o contener antes de publicar su soporte. |
| S21 | COCO-12 | E08: fidelidad de schemas antes de optimizar catálogo. |
| S25–S26 | COCO-21 | E06 contiene demo; C05 condiciona ownership/público. |
| S30–S31 | COCO-19 | E11; extensión tiene release independiente. |
| S32–S34 | COCO-18, 20 | E06/E12: ayuda honesta y arranque se adelantan; estados dependen de comportamiento real. |
| S35–S37 | COCO-22, 23, 12 | E01 eval temprano; E13 contexto/prompts medidos. |
| S38 | COCO-24 | E03 temprano; extracciones restantes solo al tocar el seam correspondiente y con paridad. |
| S39 | COCO-16, 17, 20, 22, 24 | Gate por release y E14, sin esperar todo el backlog condicionado. |

## 9. Registro de progreso

Paso activo: **E06.f**, presentación veraz de calidad en REPL. E06.b–e demos locales, escalación honesta, aceptación COMPLETE y rechazo de errores de medición DONE. E05 DONE para MCP, resultados estructurados, contexto, autoridad parental y roles coherentes; gate amplio aprobado ([evidencia](evolution/E05_AUTHORITY.md)). E04 DONE para alcance documentado; undo de archivos contenido hasta E10 ([evidencia](evolution/E04_PATHS.md)). E03 DONE para frontera compartida; autoridad padre-hijo sigue E05 ([evidencia](evolution/E03_RUNTIME.md)). E06.a DONE ([evidencia](evolution/E06_CONTAINMENT.md)); resto de E06 pendiente. E02 infraestructura npm local DONE; ejecución remota pendiente y VSIX bloqueado hasta E11; ver [registro](evolution/E02_RELEASE.md). E01 completado para baseline hermético; evaluación con modelo real pendiente, requisito de E13/E15; ver [resultados y limitaciones](evolution/E01_BASELINE.md). Después E02.a CI/gate. Commit de arranque y baseline: `df14586`. E06.a puede adelantarse para contener una promesa falsa, una vez caracterizada. Ningún paso de producto está DONE por haberse escrito este documento.

Copiar esta ficha al activar cada subpaso; conservar registros anteriores:

```text
ID / estado / fecha:
Resultado y aceptación:
Dependencias y alcance de release:
Snapshot inicial / reproducción / caracterización:
Archivos y efectos:
Comandos / entorno / exit codes / logs:
Diff final o hash de árbol revisado:
Implementador / revisor independiente / informe:
Hallazgos y resolución / revalidación:
Commit(s):
Pruebas pendientes y riesgos:
Rollback:
Publicación por canal, versión y URL (o pendiente/no aplicable):
Siguiente paso:
```

Historial:

- 2026-09-16: revisión pragmática del plan; auditoría histórica preservada. Se adelantan evals, frontera de ejecución y releases; se condicionan CLI clásico completo, plataforma pública y paralelismo especulativo. Implementación, tests de aplicación y publicaciones pendientes.
- 2026-09-16: revisión independiente de `/root/pragmatic_review`: APPROVED, sin defectos materiales. Se explicita headless en la matriz de permisos sugerida por el revisor. Revisión documental/estática; no acredita tests de producto.
- 2026-09-16: confirmado foco en programación y TypeScript; añadido E15, auditoría independiente final con prueba de adopción sin contexto previo. E01–E14 conservan su secuencia. E15 está TODO y se ejecutará después de implementar el alcance acordado; la aprobación documental anterior no corresponde a esta nueva auditoría.

## 10. Prompt para ejecutar este plan

> Trabaja en Coco siguiendo AGENTS.md, CLAUDE.md y docs/COCO_EVOLUTION_PLAN.md como progreso de esta evolución. Empieza por el siguiente subpaso preparado, revalida evidencia sobre el checkout y registra baseline; no ejecutes el antiguo listado de 39 pasos como requisitos adicionales. Mantén el runtime y los contratos existentes, evita frameworks nuevos y divide cada resultado en cambios revisables. Implementa un comportamiento, prueba efectos reales y rutas negativas pertinentes, y encarga a otro agente la revisión del diff exacto y de los logs. Corrige hallazgos materiales y revalida antes de crear un commit conventional y actualizar progreso. No avances sin revisión; no infles alcance con recomendaciones opcionales. Conserva cambios ajenos y no declares éxito, recuperación, aislamiento o calidad sin evidencia. Al completar un incremento apto para release, ejecuta el gate, verifica el artefacto instalado y publica progresivamente en los canales existentes conforme a la sección 7; registra versión y resultado real por canal. No esperes a completar el backlog condicionado. Si faltan credenciales o destino imprescindibles, deja el candidato revisado y explica el bloqueo concreto. Continúa con el siguiente incremento preparado, manteniendo evidencia y estado para poder reanudar.

> Después de completar E01–E14 para el alcance acordado, ejecuta E15 con agentes nuevos, independientes de la implementación y sin historial heredado. Conserva sus primeras impresiones antes de facilitarles evidencias internas. No des por aprobado el producto porque se hayan completado los pasos. Entrega un dictamen de adopción profesional sustentado en uso real y corrige los bloqueantes mediante el mismo ciclo de pruebas, revisión y commits. No migres Coco a Python ni amplíes su propósito hacia un agente empresarial generalista.

## 11. E15 · Auditoría final independiente y prueba de adopción profesional

**Estado: TODO. Momento: después de la implementación E01–E14 del alcance acordado.** El backlog condicionado C01–C06 no se convierte en requisito de entrada. Cualquier capacidad obligatoria excluida debe quedar registrada con motivo y efecto en las promesas del producto; no se marca implementada. E15 no sustituye la revisión de cada incremento ni bloquea las releases intermedias que superen sus gates. El programa no se declara cerrado hasta entregar este dictamen y resolver sus bloqueantes.

**Pregunta central:** «Si yo fuera un consultor que descubre Coco hoy, ¿lo utilizaría para trabajar en un repositorio de un cliente? ¿Para qué tareas, con qué supervisión y qué limitaciones?». Evaluar utilidad, capacidad práctica, buenas prácticas y confianza operativa. No buscar una impresión favorable ni una puntuación promocional.

### Independencia y condiciones de entrada

- Congelar versión, commit y hash del artefacto final; usar instalación limpia de la versión distribuida o del candidato exacto si su publicación está bloqueada, identificando cuál. No auditar un checkout modificado diferente del producto entregado.
- Asignar tres agentes nuevos que no hayan implementado los cambios, en contextos separados y sin heredar esta conversación. No usar la autoevaluación de Coco como auditoría independiente. Registrar agente, modelo/proveedor cuando se conozca, herramientas disponibles y limitaciones.
- «Externos» significa externos al equipo de implementación. Los subagentes de un mismo servicio no equivalen a una consultora humana ni garantizan diversidad de modelos. Usar modelos/proveedores distintos si están disponibles; si no, declarar esa limitación sin fingir una evaluación multivendedor. No enviar código privado a servicios nuevos sin autorización aplicable.
- Entregar al inicio únicamente el artefacto, documentación que recibiría un usuario, entorno soportado y encargos neutrales. No proporcionar el plan, los hallazgos anteriores, los resultados esperados ni consejos privados para sortear problemas. Las credenciales se configuran sin exponer secretos; no se da coaching sobre cómo resolver las tareas.
- Un coordinador prepara repositorios aislados, verificadores externos, casos no usados para ajustar prompts, límites de tiempo/coste y rúbrica antes de las ejecuciones. No cambiar criterios tras ver resultados. Si faltan accesos para uso real, registrar auditoría parcial; lectura de código y mocks no prueban adopción práctica.

### Tres perspectivas complementarias

| Agente | Primera evaluación sin contexto interno | Segunda evaluación con evidencias |
| --- | --- | --- |
| A · Consultor usuario | Instalar/configurar siguiendo docs, descubrir capacidades y resolver un encargo sin ayuda del autor. Registrar tiempo hasta primer resultado útil, fricción, intervenciones y si entiende los límites. | Contrastar sus dificultades con documentación/soporte y señalar para qué clientes o tareas lo usaría. La primera impresión se conserva sin reescribirla. |
| B · Evaluador de capacidad | Ejecutar tareas independientes: bug con regresión, pequeña feature y refactor; incluir un repositorio no usado en el ajuste y un caso con contexto prolongado. | Verificar diffs, tests, restricciones, mantenimiento del alcance, coste/tiempo y necesidad de rescate manual. Distinguir éxito autónomo, éxito asistido y fallo; comparar con baseline cuando sea equivalente. |
| C · Auditor técnico | Probar comportamiento visible de permisos, cancelación, errores y recuperación sobre fixtures seguros, usando solo documentación pública. | Después de sellar observaciones iniciales, inspeccionar código, arquitectura, CI, tests, dependencias, publicación y evidencia E01–E14. Revisar pérdida de datos, autoridad de tools/MCP, llamadas incompletas y veracidad de los resultados. |

Los agentes elaboran sus informes por separado antes de leer las conclusiones de los demás. La segunda fase puede recibir auditoría previa y plan para contrastar regresiones y promesas, manteniendo separadas observación inicial y explicación posterior. En cada tarea distinguir las acciones ejecutadas por Coco de las realizadas por el evaluador; si este arregla manualmente el código, no cuenta como éxito autónomo de Coco.

### Evidencia y dictamen

Crear `docs/audits/<fecha>-final/` al ejecutar E15, con `00-dictamen.md`, los tres informes independientes y un índice de evidencias. Conservar transcripciones, comandos/exit codes, diffs, verificadores, versiones, configuración del modelo y mediciones disponibles; excluir secretos y datos sensibles. Registrar también intentos fallidos y pruebas no ejecutadas. No afirmar superioridad sobre otros agentes sin comparación ejecutada en condiciones equivalentes.

Cada informe responde a:

1. ¿Qué tareas resuelve de verdad y cuáles requieren ayuda? ¿Qué aporta frente a trabajar manualmente o con las herramientas habituales del evaluador?
2. ¿Se instala y se entiende sin conocimiento del autor? ¿El progreso, los errores y los permisos permiten trabajar con fluidez?
3. ¿Las ediciones son correctas, proporcionadas, verificadas y mantenibles? ¿Se puede detener o recuperar sin perder trabajo ajeno?
4. ¿Arquitectura, herramientas, pruebas y publicaciones siguen prácticas razonables para el alcance local anunciado? ¿Hay complejidad que no aporta valor?
5. ¿Lo adoptaría para trabajo profesional, en qué escenarios y bajo qué condiciones? ¿Cuáles son los tres mayores obstáculos restantes?

El dictamen consolidado conserva discrepancias y separa hechos, interpretación y aspectos no evaluados. Usa una conclusión explícita: **recomendable para el alcance evaluado**, **recomendable con condiciones**, **no recomendable todavía**, o **evidencia insuficiente**. La muestra no acredita aptitud universal ni sustituye feedback de consultores humanos. No promediar una pérdida de datos o un falso éxito grave con buenas notas de diseño para obtener un aprobado.

### Correcciones y cierre

- Clasificar hallazgos con reproducción, severidad, impacto y recomendación mínima. Los bloqueantes de corrección, seguridad, pérdida de datos o promesas esenciales generan E15.fix.N; aplicar pruebas, revisión independiente y commit por incremento.
- Publicar el parche si afecta a una versión distribuida conforme a la sección 7. Reejecutar los casos afectados y el smoke del nuevo artefacto; ampliar pruebas si cambia una frontera compartida. Vincular el dictamen vigente a su versión exacta y conservar el original.
- Registrar mejoras no bloqueantes en backlog priorizado; no convertir la auditoría en una reescritura ni en un ciclo infinito para conseguir elogios. Tras dos rondas sin resolver la misma causa, documentar bloqueo y decisión necesaria.
- Marcar E15 DONE solo con los tres informes, evidencia suficiente de uso real, dictamen entregado y bloqueantes resueltos/revalidados. Puede quedar un dictamen con condiciones explícitas; si la evidencia es insuficiente o siguen bloqueantes, mantener E15 BLOCKED con causa y siguiente acción.
