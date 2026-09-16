# E07 — cancelación y coherencia de ejecución

## E07.a · DONE · 2026-09-16

La limpieza deja de descubrir procesos Vitest/Jest globales por nombre. REPL no llama al helper; export obsoleto queda como shim sin efectos. El registro distingue señal enviada de finalización y conserva procesos hasta settlement. La limpieza captura sus propietarios al comenzar, espera salida o tres segundos, cancela el timer si termina antes y escala a SIGKILL si sigue pendiente, incluso con killed:true. No borra altas concurrentes ni considera un error al señalar como prueba de salida. El handler exit también intenta SIGKILL en todos los pendientes.

Nueve regresiones con thenables y timers simulados: siete fallan contra HEAD anterior y dos conservan paridad. Después 4 archivos / 59 tests correctos, REPL separado 27 correctos. Logs `e07a-before.log`, `e07a-focused.log`, `e07a-repl.log`. Coordinador implementa; `/root/core_audit` escribe tests; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos.

Esto verifica propiedad y ciclo de vida del registro, no la terminación real de árboles de procesos. Resolver killAllSubprocesses tras SIGKILL significa intento realizado; la entrada permanece hasta finalizar. Shell, procesos hijos, señales de proveedores, cuotas y streams incompletos siguen pendientes. Sin publicación; rollback por revert.

## E07.b · DONE · 2026-09-16

bash_exec recibe AbortSignal del host, rechaza antes de lanzar si ya está cancelado y lo transmite a Execa. Registra el subprocess y configura escalada tras tres segundos. Con reject:false, cancelación, timeout, señal o código de salida ausente ya no se convierten en exitCode:0. Conserva códigos numéricos de fallo. Libera listeners propios stdout/stderr (preserva ajenos) y heartbeat al terminar o rechazar.

SDK local Execa 9.6.1; contraste con [documentación oficial de terminación de esa versión](https://github.com/sindresorhus/execa/blob/v9.6.1/docs/termination.md), consultada 2026-09-16: cancelSignal envía SIGTERM y forceKillAfterDelay controla escalada. Diez regresiones simuladas fallan antes; después 4 archivos / 60 tests correctos, incluida cancelación real tras READY de un shell exec Node con handle propio y salida confirmada. Integración Unix, omitida en Windows. Logs `e07b-before.log`, `e07b-focused.log`. Coordinador implementa; `/root/core_audit` tests; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos.

Pendientes explícitos: árboles/descendientes y background, límites de acumulación de stdout/stderr, transporte LLM/MCP y streams incompletos. Cancelar no revierte efectos anteriores del comando. Sin publicación; rollback por revert.

## E07.c · DONE · 2026-09-16

withRetry acepta señal opcional del host, verifica cancelación antes/después de la petición y antes de reintentar. La espera entre intentos libera timer/listener al cancelar o finalizar y preserva el motivo de aborto. AbortError no se considera recuperable aunque contenga un texto como 429. Mantiene las llamadas anteriores sin señal. No puede interrumpir una función que ignore la señal: el cableado efectivo de SDK sigue en E07.d.

Siete casos nuevos sobre preabort, cancelación durante espera/petición, éxito tardío, AbortError, limpieza de listeners propios y compatibilidad anterior. 2 archivos / 31 tests correctos (`e07c-focused.log`). Coordinador implementa; `/root/core_audit` tests; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos. Sin llamadas pagadas ni publicación; rollback por revert.

## E07.d · DONE · 2026-09-16

Ocho rutas OpenAI (Chat Completions/Responses × chat/tools/stream/stream-tools) transmiten signal, timeout por llamada y maxRetries:0 como opciones de transporte, separadas del payload. Coco conserva su retry configurable, ahora cancelable, sin multiplicarlo por retries internos del SDK. Preabort no inicia petición; abortos mantienen su causa. Watchdogs usan timeout por llamada. Streams comprueban aborto/timeout antes de cada emisión, además de chunk/EOF, sin convertir cierre silencioso por cancelación en done.

SDK instalado OpenAI 6.34.0, manifest conserva ^6.27.0 y lock sin cambios. [Referencia oficial TypeScript](https://developers.openai.com/api/reference/typescript), consultada 2026-09-16, secciones Cancellation/Timeouts/Retries: signal cancela petición y lectura del body; timeout admite override por petición; maxRetries:0 desactiva reintentos SDK (dos por defecto). Contrato contrastado con tipos/código SDK local. No se añaden ni retiran modelos, ni se presupone que la documentación de OpenAI valide APIs de otros proveedores.

Revisión independiente detectó cancelación entre varios yields del mismo evento y watchdog vencido antes de done; se añadieron guardias por emisión y regresiones. SDK real comprobado contra HTTP loopback: cuatro casos (dos APIs, espera de headers o body SSE) observan desconexión sin reintento ni done, sin peticiones externas ni consumo pagado. Fixtures de payload previos conservados con segundo argumento explícito. Streams truncados, deduplicación, otros proveedores y adaptadores siguen pendientes.

Validación final: 23 archivos / 646 tests correctos, incluidos 38 casos nuevos de contrato y las cuatro integraciones HTTP locales; typecheck, lint y format correctos. Logs `e07d-providers.log`, `e07d-local-sdk.log`. Coordinador implementa e integración local; `/root/core_audit` contratos; `/root/file_fixture_update` fixtures; `/root/baseline_review` APPROVED tras corregir hallazgo. Sin publicación; rollback por revert.

## E07.e · DONE · 2026-09-16

Fallback no cambia proveedor tras emitir ningún chunk (texto, inicio de tool o done); propaga el error original. Antes del primer chunk conserva fallback. Ambos wrappers comprueban cancelación antes/después de peticiones, antes/después de yield y antes de registrar éxito. CircuitBreaker ignora cancelaciones del host y errores AbortError/APIUserAbortError: no las convierte en fallo ni éxito, tampoco en half-open. Fallos reales anteriores a una cancelación durante backoff se conservan. Resilient pasa señal a withRetry y comparte su espera cancelable para streams.

46 casos nuevos: cuatro operaciones y dos wrappers, preabort, razones preservadas, cierre silencioso, no mezcla/reintento tras salida, backoff, recuperación válida y half-open. Al abortar tras yield, no se pide el siguiente evento upstream y se comprueba su finally. 6 archivos / 150 tests correctos (`e07e-focused.log`). Coordinador implementa; `/root/core_audit` pruebas; `/root/baseline_review` APPROVED. Typecheck, lint y format correctos.

Pendiente explícito: con wrapper Resilient aún hay reintentos propios anidados en algunos proveedores; el siguiente incremento delimita un propietario antes de cablear el resto de APIs. Un proveedor que ignore señal durante una operación pendiente sigue necesitando su adaptación. Sin publicación; rollback por revert.

## E07.f · DONE · 2026-09-16

ChatOptions admite maxRetries como máximo de reintentos adicionales por llamada (0 = un intento; omitido conserva default). Resilient toma ese presupuesto y pasa copia con maxRetries:0 abajo para chat/tools/streams; wrappers anidados no multiplican intentos. Las diez rutas withRetry de OpenAI, Anthropic, Vertex y Codex respetan override y señal. Presupuestos enteros seguros no negativos; configuración inválida se rechaza antes del transporte y sin penalizar circuito. Proveedores usados directamente conservan defaults. Fallback mantiene su política distinta: no es un presupuesto global entre todos los candidatos.

SDK Anthropic 0.95.2 configurado maxRetries:0, igual que el transporte OpenAI de E07.d. [Documentación oficial TypeScript Claude](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript), consultada 2026-09-16: SDK reintenta dos veces por defecto y admite desactivarlo. Contrato contrastado con SDK instalado. No hay cambio de catálogo/modelos ni payloads del modelo. Retries internos Gemini siguen pendientes de su adaptación; no se contabilizan aquí redirects ni refresh de autenticación.

24 casos nuevos con OpenAI real y SDK simulado: presupuestos directos, wrappers anidados, cuatro operaciones, copias inmutables, límite tras primer chunk e inválidos. Dos casos adicionales con SDK reales OpenAI/Anthropic y HTTP loopback que devuelve 503: presupuesto un reintento resulta exactamente dos requests. Área providers pasó 25 archivos/714 tests antes de añadir dos casos de configuración; gate final focal 70 correctos e integración SDK 2 correctos; typecheck, lint y format correctos. Logs `e07f-providers.log`, `e07f-final.log`, `e07f-sdk-retry.log`. Coordinador implementa, dos casos de configuración e integración; `/root/core_audit` pruebas; `/root/baseline_review` APPROVED. Sin publicación; rollback por revert.

## E07.g · DONE · 2026-09-16

Cuatro rutas Anthropic reciben signal, timeout por llamada y maxRetries:0 en opciones SDK separadas del payload. Preabort evita petición; abortos mantienen causa; watchdog respeta timeout por llamada. Guardias antes/después de cada emisión y en chunk/EOF impiden done o una segunda tool tras cancelar durante el mismo evento y evitan solicitar el siguiente evento upstream al reanudar. Timers se liberan al terminar o devolver anticipadamente el iterador. Modelo/catálogo y reparación actual de argumentos no cambian; truncamiento sigue pendiente.

SDK 0.95.2 y [documentación oficial TypeScript Claude](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript), consultada 2026-09-16; opciones contrastadas con tipos locales. La prueba compartida se llama ahora `test/provider-cancellation.integration.test.ts`: añade Anthropic al SDK real con HTTP loopback, usando framing SSE propio (event + data), y verifica cancelación durante headers/body, desconexión y ninguna petición repetida. No hay consumo pagado ni prueba de capacidad de modelos remotos.

32 casos nuevos de contrato y dos integraciones locales añadidas; área providers más integraciones: 27 archivos / 752 tests correctos. Typecheck, lint y format correctos. Logs `e07g-providers.log`, `e07g-sdk.log`. Coordinador implementa e integración; `/root/core_audit` contratos; `/root/file_fixture_update` fixtures; `/root/baseline_review` APPROVED. Sin publicación; rollback por revert.

## E07.h1 · DONE · 2026-09-16

Actualización aislada de @google/genai 1.50.1 a 2.22.0, fijada exactamente en manifest y lock; sin cambios de modelos ni dependencias transitivas. SDK anterior perdía cancelaciones antes del registro del listener tras inicialización asíncrona de headers. Dos pruebas con SDK real y HTTP loopback reproducen éxito incorrecto en ambos casos (preabort y aborto inmediatamente después de invocar); ambas pasan con 2.22.0 y verifican cero requests.

Versión contrastada con [registro npm oficial del paquete](https://registry.npmjs.org/@google/genai/latest), consultado 2026-09-16, tarball comprobado contra integridad SHA512 del registro; fuentes y tipos locales contrastados con [GenerateContentConfig](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html), [HttpOptions](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html) y [HttpRetryOptions](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpRetryOptions.html). Node >=20 compatible con Node22 del gate. Nuevo SDK comprueba signal.aborted antes de registrar listener; esto no sustituye limpieza del scope del adaptador, pendiente E07.h2. Cancelación cliente no garantiza cancelar trabajo/facturación en servidor.

Gate hermético Node22: providers e integraciones HTTP locales, 28 archivos / 754 tests correctos; typecheck, build, lint y format correctos. Logs e07h1-before (dos fallos esperados), e07h1-providers, e07h1-types, e07h1-build, e07h1-lint y e07h1-format. Sin inferencia externa ni publicación. Coordinador actualiza dependencia y valida; /root/core_audit escribe regresiones; /root/file_fixture_update revisa compatibilidad estática; /root/baseline_review APPROVED. Rollback por revert.

## E07.h2 · DONE · 2026-09-16

Gemini enlaza las cuatro operaciones a un scope propio, con plazo total por llamada (incluye backoff y lectura del cuerpo), señal del host y limpieza en finally. Timeout por llamada prevalece sobre configuración/default120000ms; 0 desactiva, valores inválidos se rechazan. SDK recibe abortSignal propio, timeout0 y attempts1. Salida anticipada del consumidor aborta el cuerpo pendiente; guardias tras await/chunk y antes/después de cada yield impiden éxito tardío, done o segunda emisión tras cancelar. Sondeo isAvailable usa el mismo transporte con maxRetries0.

Reintentos chat/tools pasan a Coco (default tres adicionales, override por llamada), sin multiplicación interna SDK. Errores HTTP estructurados transitorios normalizados antes de retry; auth/cuota no recuperables. Streams no reintentan dentro del adaptador; wrappers siguen teniendo la política de E07.e/f. Constructor admite baseUrl configurado. No cambia modelos ni payloads de generación; integridad/truncamiento de streams sigue pendiente. Contrato consultado en fuentes oficiales y SDK2.22.0 documentados en E07.h1.

66 casos de contrato independientes; SDK real HTTP loopback prueba aborto esperando headers/SSE, deadline con body pendiente, earlyreturn con desconexión y presupuesto externo sobre503 exactamente dos peticiones. Gate providers más integraciones:30 archivos/825 tests correctos; typecheck/lint/format correctos. Logs e07h2-providers/types/lint/format. Coordinador implementación e integración; /root/core_audit contratos; /root/file_fixture_update revisión estática favorable. Sin peticiones pagadas ni publicación; rollback por revert.

Gate amplio tras E07.h2: 331 archivos / 7330 tests correctos y 15 omitidos; REPL separado 27 correctos; build correcto. Logs e07h2-main/repl/build. /root/baseline_review APPROVED; E07 sigue abierto para otros transportes, árboles, cuotas e integridad de streams.

## E07.i · DONE · 2026-09-16

Vertex usa scope por operación para señal, deadline total (autenticación/backoff/headers/body) y limpieza; cuatro rutas y sondeo isAvailable. Pasa señal hasta getCachedADCToken/inspectADC y fetch; no acepta tokens/JSON tardíos tras aborto. ADC ejecuta gcloud con timeout10s y AbortSignal: argv directo sin shell en POSIX; Windows conserva shell para gcloud.cmd con comando constante sin interpolación de usuario, y comprueba cancelación incluso en cachehit. Conservar timeout0 y contratos ADC anteriores. Inicialización ADC también queda acotada. No se afirma terminación verificada de árboles gcloud: señal enviada y rechazo no prueban salida de descendientes; esa comprobación pertenece al incremento de procesos.

Streams comprueban aborto entre emisiones del mismo evento y al leer; finally cancela lector y libera lock en éxito/error/retorno. Parseo JSON separado de yield para no capturar excepciones de cancelación como errores de parseo. Sin cambiar catálogo ni deduplicación/truncamiento actual, pendientes del incremento de integridad.

REST v1 generateContent/streamGenerateContent y SSE contrastados con [referencia oficial Google](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/inference), consultada 2026-09-16 (redirige la antigua URL Vertex); fetch nativo Node22 sin SDK/retries ocultos. [Referencia oficial child_process](https://nodejs.org/api/child_process.html) confirma execFile con argv sin shell y soporte signal; SDK de modelos y credenciales del usuario no se usan en pruebas.

48 casos de contrato Vertex y10ADC independientes; integraciones HTTP locales compartidas ahora incluyen Vertex para headers/body, deadline/earlyreturn con desconexión y presupuesto de retry503. Prueba de lifecycle renombrada provider-lifetime.integration.test.ts. Gate área providers/auth/onboarding e integraciones:33 archivos/917 tests correctos. Typecheck/lint/format correctos. Logs e07i-providers/types/lint/format. Coordinador implementación/integraciones; /root/core_audit contratos Vertex; /root/file_fixture_update contratos ADC. Sin publicación; rollback por revert.

Revisión E07.i detectó regresión potencial gcloud.cmd/Windows y se corrigió con launcher fijo sin datos de usuario. Tres regresiones adicionales simulan Windows; no constituyen smoke real en ese SO. Gate final7 archivos/116 tests correctos; typecheck/lint/format correctos (e07i-final).

/root/baseline_review APPROVED tras corrección; total13 casos ADC (10 iniciales y3Windows).

## E07.j · DONE · 2026-09-16

Cuatro operaciones Codex usan scope con señal hasta fetch y plazo total por llamada/configuración (default120000,0desactiva). Sustituye watchdogs que solo marcaban un flag sin desbloquear reader.read. Lector SSE compartido para chat/tools/streams, cancelado y lock liberado en finally; guardias antes/después de lecturas y emisiones, causa preservada, sin resultado final tras cancelación ni petición adicional durante backoff. El parseo separado no absorbe excepciones del consumidor/cancelación como JSON inválido.

Endpoint ChatGPT backend separado de OpenAI API estándar; conserva autenticación, catálogo y payloads existentes. Contraste de transporte Responses con [fuente oficial OpenAI Codex](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/responses.rs), consultada2026-09-16; no se declara contrato público estable del backend ni se asume compatibilidad completa con API OpenAI. Autenticación initialize/isAvailable y renovación OAuth siguen pendientes de incremento propio; tampoco cambia aquí integridad/truncamiento/deduplicación de tools.

48 casos independientes +51 anteriores correctos. Seis integraciones con fetch real redirigido únicamente desde endpoint esperado a HTTP loopback y OAuth fixture: cuatro rutas antes de headers y dos streams con body pendiente; desconexión, motivo preservado y una petición. Gate providers/integración29 archivos/912 tests correctos; typecheck/lint/format correctos. Logs e07j-providers/types/lint/format/http. Coordinador implementación y HTTP; /root/core_audit contratos. Sin conexión a cuentas ni inferencia externa; rollback por revert.

/root/baseline_review APPROVED E07.j; inicialización y renovación OAuth quedan para E07.k.

## E07.k1 · DONE · 2026-09-16

Renovación OAuth administrada por getValidAccessToken: scope30s, señal a fetch/body, preabort antes de leer credenciales y sin retry automático de POST. Fallos de red, cancelación, timeout, respuesta inválida y errores de persistencia ya no borran credenciales. Error de refresh ahora se propaga al caller (flow/Codex initialize), no null seguido de reautenticación/fallback automático; ausencia/expiración sin refresh devuelve null conservando archivo. Errores HTTP no vuelcan el body sensible. refreshAccessToken es primitiva con señal del caller; getValidAccessToken posee el deadline.

Rotación completamente recibida y validada se guarda antes de propagar cancelación sobrevenida, para no perder refresh token nuevo. Save usa temporal sibling UUID, creación exclusiva600, rename y limpieza; evita truncar archivo anterior. Fallo de persistencia conserva causa y prevalece frente a aborto concurrente. No promete revertir una rotación remota ni durabilidad ante caída del sistema; fallo de disco puede exigir recuperar autenticación. Operaciones locales de persistencia se esperan, no se abandonan por Promise.race. Helper de scope pasa de providers a utils para compartir con auth, sin duplicar implementación.

Fundamento: [RFC6749 sección6](https://www.rfc-editor.org/rfc/rfc6749#section-6), consultada2026-09-16, contempla reemplazo de refresh token; [documentación oficial de autenticación Codex](https://developers.openai.com/codex/auth/) consultada la misma fecha. Sin cambio de clientID/endpoints/modelos, ni afirmación de compatibilidad de toda la autenticación interactiva. Concurrencia de refresh y Copilot siguen pendientes de E07.k2 y siguientes.

28 casos OAuth con red/FS simulados y cuatro de filesystem temporal real: permisos POSIX600/700, reemplazo, escritura parcial fallida y rename fallido preservan anterior/limpian temporales. No se cambian HOME ni credenciales reales; FSredirigido estrictamente a fixture. Gate amplio:337 archivos/7482 tests correctos,15 omitidos; REPL separado27 correctos; typecheck/lint/format/build correctos. Logs e07k1-main/repl/types/lint/format/build. Coordinador implementa y añade caso overflow; /root/core_audit pruebas de contrato; /root/file_fixture_update integración FS. Sin publicación; rollback por revert.

/root/baseline_review APPROVED E07.k1; no valida concurrencia de renovación ni Copilot.

## E07.k2 · DONE · 2026-09-16

Autenticación Copilot tiene scope30s, señal a HTTP y procesos gh, preabort y preservación de causa. Caché válida evita CLI; token GitHub de entorno/credenciales evita gh auth token innecesario. Abortos no activan fallback; fallo de gh no demuestra invalidez y nunca borra credenciales automáticamente. Fallo de persistencia tampoco activa fallback y prevalece ante aborto concurrente. Se comparte con OAuth la escritura privada/atómica extraída a credential-storage, sin duplicar implementación.

Fallback gh api recibe el mismo token GitHub por entorno, nunca argv, y hostnamegithub.com explícito; evita mezclar cuentas y respeta el host del HTTP original frente a GH_HOST. Las credenciales guardadas corresponden al token usado realmente. [Manual gh auth token](https://cli.github.com/manual/gh_auth_token), [gh api](https://cli.github.com/manual/gh_api) y [variables de entorno](https://cli.github.com/manual/gh_help_environment), consultados2026-09-16: hostname configurable y GH_TOKEN tiene precedencia. Esto no convierte copilot_internal en API pública estable ni acredita funcionamiento de cuentas reales. No cambia modelos/clientID/endpoints.

Respuesta exige token no vacío y caducidad válida; revisión detectó overflow de segundos a ms, corregido en HTTP y CLI con dos regresiones. 25 casos nuevos de contrato con FS/HTTP/exec simulados; fixtures previos actualizados para preservación de credenciales y gh único. Las señales de los callers del provider y su renovación compartida aún deben conectarse en E07.k3. Árboles/procesos reales e interacción OAuth continúan fuera de este incremento.

Gate finalE07.k2:5 archivos/116 tests correctos; typecheck/lint/format correctos. Logs e07k2-final/types/lint/format. Coordinador implementa; /root/core_audit contratos25; /root/file_fixture_update fixtures; /root/baseline_review APPROVED tras overflow. Sin publicación; rollback por revert.

## E07.k3 · DONE · 2026-09-16

Provider Copilot enlaza cuatro operaciones a scope total que incluye autenticación/retries/SDK/body. Inicialización e isAvailable también tienen plazo configurado. La renovación compartida por instancia tiene controlador propio y consumidores identificados: cancelar uno no interrumpe otro; al retirarse el último se aborta auth. Estado y promesa permanecen gestionados hasta settlement, incluida persistencia local ya iniciada; señales y listeners de consumidores se retiran al terminar/cancelar. Peticiones nuevas no heredan la cancelación de un intercambio anterior aún cerrándose. Resultado tardío cancelado no sustituye el cliente SDK. No se afirma serialización OAuth global entre instancias/procesos.

41 casos independientes: cuatro rutas, deadlines/timeout0, dos consumidores con cancelación/deadline independientes, último consumidor, respuesta tardía, nuevo refresh, configuración directa y ciclo de streams. Dos casos detectaron lectura upstream adicional tras yield cancelado; wrapper ahora comprueba antes/después de cada emisión. Integración HTTP compartida incluye Copilot con SDKOpenAI real y authfixture, cancelación durante headers/body y desconexión, sin cuenta externa. API y fuentes son las contrastadas en E07.d/k2; catálogo preservado.

Gate área providers/auth25:30 archivos/967 tests correctos; HTTP compartido12 correctos. Gate final3 archivos/71 tests y typecheck/lint/format correctos.

Revisión E07.k3 detectó que el último consumidor cancelado podía ocultar un fallo de persistencia posterior. Ahora espera settlement y conserva ese error; los otros consumidores pueden cancelar independientemente. Tres regresiones cubren ENOSPC y una petición nueva que espera cierre previo, sin renovar después de fallo de guardado. Logs e07k3-final/types/lint/format. Coordinador implementa/HTTP; /root/core_audit contratos.

Revisión final también preserva errores de guardado en initialize y al cancelar un consumidor nuevo durante cierre previo. Dos regresiones adicionales correctas; /root/baseline_review APPROVED. Log e07k3-reviewed.

## E07.l1 · DONE · 2026-09-16

Cliente MCP propio recibe signal/timeout por llamada; preabort evita envío y timeout0 desactiva el plazo. Validación rechaza plazos negativos/no finitos/fuera del rango Node. Settlement único elimina pending, timer y listener ante respuesta, error RPC/transporte, cierre, cancelación y throw/rechazo de send; respuestas tardías se ignoran y cancelar A no afecta B. Wrapper pasa contexto al cliente, conserva causa y comprueba aborto antes de devolver resultado. Eliminado Promise.race con timer huérfano.

Esto cancela la espera local únicamente: transporte y notificación al servidor son E07.l2 y siguientes. [Especificación MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation), consultada2026-09-16, permite que servidor ignore cancelación; no se promete rollback remoto. Coco no usa aquí SDK MCP sino su cliente propio.

20 casos nuevos independientes y fixtures de contrato/permiso ajustados. Gate MCP15 archivos/248 tests correctos; typecheck/lint/format correctos. Logs e07l1-final/types/lint/format. Coordinador implementa; /root/core_audit contratos; /root/file_fixture_update APPROVED revisión estática. Sin publicación; rollback por revert.

## E07.l2 · DONE · 2026-09-16

Señal por solicitud hasta stdio/HTTP/SSE. Cliente aborta el transporte al finalizar; cancelación/deadline de solicitudes emitidas envía notifications/cancelled sinid y sin motivo sensible, con plazo1s; initialize nunca se notifica como cancelado. Inicialized también es notificación sinid. Fallos de notificación no cambian el resultado original ni otras solicitudes. Stdio espera callback de su escritura, limpia listener y evita drain compartido. No puede retirar bytes ya encolados ni acreditar terminación del trabajo remoto.

HTTP tiene scope incluyendo JSON/SSE, registros limpiados y lector cancelado/liberado; error individual no rechaza otras solicitudes. SSE POST tiene señal independiente más señal de conexión, deadline y limpieza del body; aborto ya no devuelve éxito. No hay replay automático de POST ni heurísticas de autenticación sobre errores de aplicación. Revisión detectó replay por redirección307/308: redirect:error en ambos POST; pruebas reales307 confirman origen1/destino0. Configuración retries conservada por compatibilidad, sin repetir POST.

Contención temporal explícita: HTTP conserva tokens almacenados/bearer/APIkey, pero no inicia OAuth sin cancelación dentro de send; recuperación interactiva se restablecerá en E07.l3 de forma acotada a initialize y HTTP401. Es un pendiente antes de cerrar E07, no una eliminación definitiva. Recepción SSE compartida, cuotas/frames y OAuth todavía requieren trabajo. Fuente protocolo y límites de cancelación descritos en E07.l1.

Gate18 archivos/283 tests correctos; typecheck/lint/format correctos. Contratos independientes9stdio+13HTTP/SSE+7cliente; seis integraciones HTTP reales locales, incluida conexión reutilizable y notificación exacta. Logs e07l2-final/types/lint/format. Coordinador cliente/SSE/integraciones; /root/file_fixture_update HTTP; /root/core_audit contratos; /root/baseline_review APPROVED. Sin publicación ni cuentas externas; rollback por revert.

## E07.l3 · DONE · 2026-09-16

Restablecida recuperación OAuth únicamente durante initialize ante HTTP401, una sola vez y dentro del plazo/señal de la solicitud. Tools y errores JSON-RPC no autorizan reenvío. OAuth tiene scope propio5min y señala discovery, registro, token, navegador y callback. Refresh no requiere TTY; sus fallos no activan login/retry ambiguo. Scope y servidor callback se cierran en finally; callback escucha solo loopback, admite señal y close explícito, observa rechazos tempranos. APIaditiva conserva flow.ts; su cancelación de onboarding antigua sigue requiriendo trabajo, no se declara resuelta aquí.

Almacén vacío solo por ENOENT; errores de lectura/JSON no se ocultan. Guardado usa helper atómico privado. Rotación conocida y clientID conocido se guardan antes de propagar aborto; refresh omitido conserva anterior. Fallos de persistencia tienen prioridad; cliente initialize espera que el transporte termine de guardar cuando vence su plazo, sin aceptar respuestas tardías. No garantiza concurrencia entre procesos ni recuperación de una rotación cuya respuesta nunca llegó.

Tres hallazgos de revisión corregidos: URLmalformada del callback responde400 sin tumbar proceso ni cerrar espera; POSTOAuth usa redirect:error evitando repetir registro/intercambio; el deadline del cliente ya no oculta el fallo de disco posterior. Fuente [MCP authorization2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), consultada2026-09-16, para discovery/challenge401 y flujoHTTP; no se afirma implementación completa de extensiones/registro de esa versión.

Contratos16OAuth independientes,6callbackloopback,2cliente y5HTTPadicionales. Gateárea20 archivos/312 tests; gateamplio345 archivos/7634 correctos y15 omitidos; REPL27; typecheck/lint/format/build correctos. Logs e07l3-final/final-types/final-lint/final-format/main/repl/build. Coordinador callback/cliente/HTTP; /root/file_fixture_update OAuth; /root/core_audit contratos; /root/baseline_review APPROVED. Sin cuentas externas/publicación; rollback por revert.

## E07.m1 · DONE · 2026-09-16

Manager de agentes delegados propaga señal propia con motivo del host al modelo y las tools, comprueba aborto tras respuesta/entre tools/antes de finalizar, elimina listener externo y timer en finally. Timeout0 desactiva; valores inválidos se rechazan. Cancelar conserva registro activo hasta settlement, sin éxito ni tools/salida tardías. Resultado estructurado sigue failed por compatibilidad; evento cancel depende de la señal, no del texto del error. Consumo ya reportado se conserva; error de persistencia tardío mantiene diagnóstico.

Revisión detectó timeout secundario después de cancel(id) mientras provider seguía pendiente: guardia impide doble clasificación, con regresión que avanza cinco minutos. Diez casos nuevos independientes; gate20 archivos/269 tests correcto, typecheck/lint/format correctos. Logs e07m1-final/final-types/final-lint/final-format. /root/core_audit contratos; /root/baseline_review APPROVED. El ejecutor alternativo y graph runner siguen pendientes; no se declara cancelación global de todos los agentes.

## E07.m2 · DONE · 2026-09-16

AgentExecutor alternativo propaga señal del contexto al modelo, comprueba aborto antes/después de petición y entre tools; cancelación en tool sale del bucle sin ejecutar la siguiente ni pedir otro turno. Respuestas tardías no producen éxito; consumo conocido y diagnóstico de fallo independiente se conservan en resultado estructurado. Siete contratos independientes cubren ejecución directa/delegada mediante runtime real en memoria. Gate6 archivos/82 tests y typecheck/lint/format correctos; logs e07m2-final/types/lint/format. /root/core_audit contratos; /root/baseline_review APPROVED. Graph/workflow y recepción MCP compartida siguen pendientes.
