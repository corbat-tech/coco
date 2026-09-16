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
