# Publicación npm 2.42.0 estable

Fecha: 2026-10-07. Base funcional: 2.42.0-rc.4; esta promoción cambia la versión y el registro de entrega, sin cambios de comportamiento. Canal previsto: npm `latest`. El resultado de publicación, integridad e instalación se registra en la release de GitHub.

## Decisión y evidencia

El usuario autoriza promover la entrega a `latest` tras instalar la última candidata y comprobar GPT-6 Luna y el saludo «hola», confirmando que ya responde correctamente. Es evidencia de uso real aportada por el usuario, limitada a ese proveedor/modelo y flujo; no se presenta como una evaluación general de capacidad.

La candidata RC4 tiene gate completo aprobado: typecheck, lint, formato, 8.411 tests principales, 28 REPL y build; cobertura statements 80,25%. Auditoría de dependencias sin avisos conocidos; CI, CodeQL y Snyk aprobados. La instalación desde npm y las regresiones con proveedor simulado verificaron CLI, exports, herramienta real de lectura, rechazo de llamadas inventadas/preautorizadas para mensajes sociales y conservación de herramientas en peticiones mixtas.

La promoción estable vuelve a ejecutar el gate, empaqueta una vez, instala el artefacto limpio, publica mediante OIDC y comprueba la integridad e instalación desde el registro. No se reutilizan tags ni versiones publicadas. VSIX/Marketplace no se publican en esta entrega.

## Alcance pendiente

La autorización de publicación sustituye la retención de `latest` del plan anterior. No convierte en completas las evaluaciones de capacidad que siguen pendientes en REMAINING_DELIVERIES.md: perfil recomendado con corpus reservado y recorrido práctico completo independiente. Los resultados limitados de Ollama se mantienen como evidencia histórica; no se atribuyen a GPT-6 Luna ni a todos los proveedores. No se hacen nuevas llamadas a APIs de pago ni se declaran soportadas regiones/cuentas no probadas.

Recuperación: instalar explícitamente `@corbat-tech/coco@2.41.0` o `@corbat-tech/coco@2.42.0-rc.4`. `next` permanece en RC4 hasta otra entrega de ese canal.
