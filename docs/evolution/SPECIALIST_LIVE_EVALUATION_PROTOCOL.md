# Protocolo reproducible para evaluar especialistas

Estado: preparación de P7; **no se ha ejecutado una campaña con modelos reales mediante este protocolo**. Este documento no modifica los criterios P0 congelados ni acredita ventajas de calidad, velocidad o coste.

## 1. Qué está preparado y qué falta

El harness [`specialist-evaluation.ts`](../../test/benchmarks/specialist-evaluation.ts) acepta un adaptador del host y un verificador externo, sin importar SDKs de proveedores ni iniciar llamadas por sí mismo. Sus tests usan adaptadores guionizados y archivos temporales reales. Demuestran aislamiento de entradas, conservación de fallos, aplicación de criterios externos y límites del propio harness; no miden capacidad de programación de un modelo.

El corpus [`test/fixtures/delegation/corpus.json`](../../test/fixtures/delegation/corpus.json) contiene 36 escenarios para decisiones de reparto. Es un **corpus de routing**, no 36 ejercicios de programación con repositorios y aceptación funcional ejecutable. No convertir sus etiquetas ni su reparto development/reserved en una puntuación de ingeniería de software.

Ya están preparados doce [ejercicios de código](../../test/fixtures/delegation/projects/manifest.json): cuatro bugs locales, cuatro cambios de contrato ordenados y cuatro cambios en módulos independientes. Ocho son de desarrollo y cuatro reservados **después de implementar el núcleo**, sin presentarlos como benchmark ciego previo. Son ejercicios sintéticos autocontenidos, no una muestra de repositorios industriales. Los doce baselines fallan su aceptación externa y las doce soluciones conocidas la superan ejecutando Node real.

Los graders y soluciones están fuera de los directorios copiados al agente. Los hashes de fuentes y aceptación se congelan en el manifiesto; los tests y archivos de solución fuera de scope no son editables por el adaptador. [specialist-coco-adapter.ts](../../test/benchmarks/specialist-coco-adapter.ts) usa la ejecución real de Coco con un proveedor inyectado y captura de solicitudes, sin inicializar proveedores ni cargar credenciales. [specialist-pilot-runner.ts](../../test/benchmarks/specialist-pilot-runner.ts) conecta ese adaptador, los tests públicos, el grader externo y el harness, y rechaza empezar sin `approvedConsumption === true` proporcionado por el host tras autorización humana.

Antes de consumir quedan la selección explícita del proveedor/modelo y esfuerzo, el presupuesto aprobado y el destino autorizado para las evidencias. Antes de ampliar conclusiones hay que añadir proyectos representativos ajenos a estos fixtures y aceptación reservada nueva; no extrapolar estos doce ejercicios al mercado.

Smoke propuesto, todavía **no ejecutado con modelos**: `local-clamp`, `ordered-cents`, `parallel-statistics`, tres configuraciones, una repetición: nueve intentos. Con `maxTurns: 8`, el adaptador admite como máximo 72 invocaciones lógicas al proveedor; reintentos internos del SDK deben declararse aparte. `maxTokens: 4096` es reserva solicitada por respuesta, no garantía de factura ni de límite duro en todo adaptador. Timeout de 120 segundos por intento; duración máxima secuencial solicitada de 18 minutos, además del cierre/inspección necesario tras cancelación. El piloto completo de 12 × 3 × 3 son 108 intentos y requiere aprobación distinta del smoke.

Ejemplo de configuración del ejecutor (el host proporciona `provider`, `model`, `commit` y la autorización real):

```ts
await runCocoPilotCampaign({
  provider, model, thinking: "medium", commit,
  outputDirectory: "/ruta/autorizada/campana-nueva",
  split: "development",
  caseIds: ["local-clamp", "ordered-cents", "parallel-statistics"],
  configurations: ["direct", "manual", "auto"],
  repetitions: 1, maxRuns: 9, maxTurns: 8, maxTokens: 4096, timeoutMs: 120_000,
  approvedConsumption: approvalRecordedByHost,
});
```

La disponibilidad de esas funciones no autoriza la campaña. La autorización para implementar y ejecutar tests locales no incluye consumo real de suscripción/API.

## 2. Contrato del harness

Cada `SpecialistEvaluationCase` contiene:

- `id`: identificador estable y seguro, sin rutas ni secretos.
- `snapshotId`: commit o versión congelada del fixture de código.
- `fixtureDirectory`: carpeta preparada expresamente por el host, sin enlaces simbólicos ni credenciales.
- `expectedFixtureSha256`: hash calculado con `hashSpecialistFixture` y congelado antes de la evaluación. Incluye rutas relativas, contenido y permisos.
- `acceptanceId`: versión o hash del verificador externo conservado en el repositorio de evaluación.
- `task`: petición idéntica en las configuraciones comparadas; el manifiesto guarda su hash.

El harness lee una copia inmutable del contenido de cada fixture antes del primer intento. Cada ejecución recibe un directorio temporal diferente con los mismos bytes iniciales. Se rechazan fixtures cuyo hash cambió, enlaces simbólicos, archivos especiales y fixtures mayores de 4096 archivos o 32 MiB. Para repositorios mayores, el host debe congelar un fixture acotado y significativo; no copiar dependencias, `.git`, secretos ni todo el HOME.

Cada `EvaluationContext` proporciona caso, configuración, repetición, workspace, tarea y `AbortSignal`. El adaptador `runCase(context)` debe ejecutar realmente la configuración solicitada, usando únicamente ese workspace y las herramientas autorizadas. Devuelve estado `completed`/`failed`, consumo observado cuando esté disponible y eventos resumidos opcionales.

`check(context)` es un callback diferente, mantenido por el evaluador, que inspecciona archivos o ejecuta los comandos externos congelados y devuelve criterios booleanos no vacíos. No recibe una nota del modelo como entrada de aceptación. Un fixture cuyo agente afirma «100/100» y conserva código incorrecto debe fallar. Un agente que falla después de aplicar un cambio conserva estado fallido aunque algunos checks observen efectos correctos.

Los comandos del verificador también deben respetar señal y límites del host. No aceptar como prueba de ejecución un mock del comando, un recibo fabricado por el modelo o una respuesta redactada como «tests passed».

## 3. Configuraciones comparables

Comparar `direct`, `manual` y `auto`, o un subconjunto explícito para un smoke. El adaptador mantiene constantes:

- Snapshot inicial y petición, instrucciones de proyecto, herramientas ofrecidas y permisos efectivos.
- Modelo y esfuerzo solicitados; registrar aparte los valores efectivos observados en el transporte cuando sea posible.
- Límites globales de turnos, entrada, salida, concurrencia y duración por trabajo. No otorgar el presupuesto completo a cada worker.
- Entorno, dependencias y comandos de verificación.

`direct` ejecuta sin workers; `manual` fuerza un único implementador explícito (no una descomposición manual óptima de un equipo); `auto` deja elegir al producto dentro de la misma autoridad y presupuesto. No cambiar el modelo de una configuración para hacerla ganar. Una implementación sin adaptador real no debe obtener una ejecución puntuada mediante simulación.

El harness rota el orden de las configuraciones por caso/repetición y lo invierte en repeticiones alternas. Nunca reutiliza el workspace modificado por otro intento. No reutilizar conversación, caché de sesión con contexto anterior o memoria de otro caso; las diferencias inevitables de caché del proveedor se registran.

## 4. Límites y cancelación

`maxRuns` es el máximo aprobado de invocaciones al adaptador. El harness comprueba antes de despachar que `casos × configuraciones × repeticiones` cabe por completo en ese límite; no recorta una comparación pareada a posteriori. Ningún intento puntuado se reintenta automáticamente.

`timeoutMs` limita la operación adaptador + aceptación de cada intento. Al vencer, el harness aborta su señal, registra `timeout`, retiene el workspace y detiene la campaña antes de iniciar otro intento. Una cancelación del host produce `cancelled`; los intentos que no llegaron a iniciarse se cuentan por separado.

**Abortar un callback JavaScript no garantiza terminar su proceso o sus efectos.** El adaptador real debe cancelar proveedor, comandos y descendientes y demostrar que libera recursos al asentarse. El harness deja de esperar un adaptador que ignora la señal, pero no destruye su workspace ni afirma haber detenido ese proceso. Antes de continuar otra campaña hay que inspeccionar terminación y efectos retenidos. Esto no es un sandbox del sistema operativo ni un límite monetario del proveedor.

Además del número de intentos y timeout, el adaptador debe aplicar presupuestos reales de llamadas/tokens compartidos entre coordinador y workers. El harness registra uso o `null` cuando se desconoce; no transforma ausencia de contabilidad en coste cero. Un límite de salida no serializado por el proveedor no se anuncia como garantía dura.

## 5. Evidencias y privacidad

La carpeta de salida debe ser nueva. El harness no reemplaza una campaña anterior. Conserva:

| Archivo | Contenido |
| --- | --- |
| `manifest.json` | Commit declarado, modelo/esfuerzo, versión del adaptador, hashes de prompts/política, entorno Node/plataforma/arquitectura y hash del entorno; casos, snapshots, aceptación, hashes de fixtures/tareas y límites. Incluye su hash de integridad. |
| `traces.jsonl` | Inicio y resultado de cada intento, identidad, criterios externos, uso conocido/desconocido, errores y eventos observables limitados. |
| `results.json` | Resultados puntuados sin ocultar fallos, intentos previstos/realizados/no iniciados y motivo de interrupción. |
| `workspaces/` | Copia separada de los archivos y efectos de cada ejecución, para inspección posterior. |

Los campos de identidad del manifiesto son declaraciones del host; sus hashes detectan cambios de configuración, pero no prueban por sí solos qué modelo respondió. Para atribuir resultados a un proveedor real hay que conservar evidencia saneada de la configuración efectiva o de las peticiones, sin credenciales.

El harness redacta patrones habituales de credenciales y valores sensibles adicionales proporcionados por el host, antes de escribir JSON o devolver el informe. La redacción no es una garantía de anonimización completa: el adaptador solo debe emitir eventos permitidos y breves. No pasar razonamiento privado, cabeceras de autorización, prompts privados completos, código sensible innecesario ni volcados de entorno. Los workspaces contienen código y deben almacenarse en un destino autorizado con la retención acordada.

Mantener también las versiones de los scripts de aceptación y el código del adaptador. No borrar el harness ni los resultados crudos saneados al cerrar la tarea. Si hay un error del harness, conservar el intento con su diagnóstico y clasificarlo explícitamente; no sustituirlo silenciosamente por una ejecución favorable.

## 6. Secuencia de la campaña

1. Congelar fixtures, aceptación, configuración y separación development/holdout. Revisar que las pruebas reservadas cubren comportamiento y no reflejan únicamente la implementación propuesta.
2. Probar el adaptador sin modelos de pago: comandos exactos, scopes, cancelación, recibos y salida estructurada. Ejecutar los tests del harness.
3. Preparar el presupuesto: número máximo de intentos y llamadas por intento, límites de tokens y tiempo, modelo, coste estimado verificable y tratamiento del consumo desconocido. Presentarlo para aprobación antes de consumir.
4. Tras aprobación, realizar un smoke pequeño identificado como diagnóstico. No incluirlo retroactivamente en una puntuación congelada.
5. Hacer un piloto pareado: por ejemplo, 12 ejercicios reales × 3 configuraciones × 3 repeticiones = 108 intentos, únicamente si cabe en el presupuesto aprobado. La ampliación a 36 ejercicios supone 324 intentos bajo el mismo diseño; requiere que esos ejercicios existan y estén congelados.
6. Ajustar usando casos de desarrollo. No editar prompts a partir del holdout y después presentar el mismo holdout como evaluación independiente.
7. Ejecutar la evaluación reservada, conservar todos los resultados y contrastar con G1–G9 del plan original. No cambiar esos objetivos tras ver los resultados.
8. Mantener `auto` optativo/desactivado si faltan evidencias o no supera los gates. No confundir una campaña parcial con aceptación global de la mejora.

Si se añade OpenCode, congelar su versión y usar herramientas/permisos equivalentes, anotando diferencias reales de interfaz y parámetros. Ese comparador es opcional; no convertir una muestra pequeña en un ranking del mercado.

## 7. Lectura de resultados

La métrica primaria es aceptación funcional externa por tarea; acompañarla de violaciones de autoridad, falsos completados, regresiones y requisitos conservados. Registrar por separado fallos de proveedor, errores del harness y uso desconocido.

Informar aceptación por clase de tarea y configuración, intentos previstos/realizados/no iniciados, tiempo total y distribución de tokens acumulados de padre + workers. Un timeout no desaparece del denominador de intentos realizados. Una interrupción temprana deja una muestra incompleta: no concluir ventaja global a partir de los casos favorables que llegaron a ejecutarse.

Usar comparaciones pareadas y agrupar incertidumbre por tarea, sin tratar repeticiones de un mismo ejercicio como muestras independientes. No proclamar p95 fiable con tres repeticiones. Una opinión de otro modelo puede ayudar a revisar defectos, pero no sustituye aceptación ejecutada ni constituye una auditoría humana independiente.

Los objetivos de mejora de tiempo y límites de consumo son los del plan P0; los tests deterministas y este protocolo no los demuestran. Las pruebas de routing tampoco acreditan mejoras de programación.

## 8. Comprobación local disponible

```sh
fnm exec --using=24.22.1 pnpm exec vitest run test/benchmarks/specialist-evaluation.test.ts --maxWorkers=2
```

Este comando ejecuta tests locales sin llamadas a modelos. Las pruebas verifican aceptación basada en archivos reales, entradas idénticas y workspaces separados, orden alternado, fallos retenidos, consumo desconocido, redacción de trazas, rechazo de fixture cambiado/presupuesto insuficiente y timeout de un adaptador no cooperativo sin iniciar trabajos posteriores.
