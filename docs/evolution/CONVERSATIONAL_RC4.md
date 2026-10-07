# Flujo conversacional — 2.42.0-rc.4

## Diagnóstico y mejoras ejecutadas

Un saludo como «hola» podía provocar `bash_exec` con `printf` y abrir la confirmación. El prompt exigía herramientas para toda respuesta y reservaba el texto para confirmar operaciones. Se corrigió para separar acciones externas de conversación, explicaciones y ejemplos de código.

La revisión cubrió el prompt base, el añadido para modelos compactos, los enhancers de verificación y paralelismo, la recuperación de turnos sin herramientas, las confirmaciones, el bucle de calidad y el runner reutilizable del runtime.

- Saludos, agradecimientos y despedidas aislados reconocidos en español e inglés no ofrecen herramientas al proveedor. Una llamada inventada se rechaza antes de pedir permiso o ejecutar, también en el runtime y aunque la herramienta estuviese preconfirmada.
- Las peticiones mixtas («hola, ejecuta los tests»), continuaciones ambiguas («sí», «continúa») y mensajes con adjuntos conservan las herramientas.
- La recuperación deja de forzar herramientas al detectar texto introductorio de una explicación. Los reintentos permiten contestar directamente cuando no se necesita una operación externa.
- La verificación se exige para afirmar que se completaron acciones externas; las respuestas conversacionales no deben fabricar comandos para demostrar que terminaron.
- Las instrucciones de acción evitan confirmaciones redundantes, pero permiten pedir requisitos realmente necesarios.

## Validación y límites

Pruebas de regresión con proveedores simulados que intentan emitir llamadas no solicitadas, respuestas explicativas y solicitudes mixtas. El gate de release incluye typecheck, lint, formato, cobertura, REPL y build. Publicación prevista en npm `next`, con instalación limpia desde el registro y comprobación de integridad. El resultado final por canal se registra en la release de GitHub.

El reconocimiento determinista es deliberadamente limitado a mensajes sociales aislados. No bloquea preguntas generales que podrían necesitar consultar archivos o datos actuales, ni interpreta confirmaciones como saludos. Los prompts orientan esos casos, sin afirmar una garantía sobre todas las respuestas de todos los proveedores. No se ejecutan pruebas contra APIs de pago.

La promoción estable sigue pendiente de la evaluación práctica descrita en REMAINING_DELIVERIES.md. VSIX/Marketplace quedan fuera de esta entrega. Recuperación: instalar la candidata anterior 2.42.0-rc.3 o la estable 2.41.0; las versiones publicadas son inmutables.
