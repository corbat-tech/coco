# Actualización de proveedores — 2.42.0-rc.3

Fecha: 2026-10-07. Canal previsto: npm `next`; `latest=2.41.0` se conserva. [PR de integración](https://github.com/corbat-tech/coco/pull/219).

## Alcance

22 proveedores, incluidos xAI, MiniMax, Cerebras, Azure OpenAI y Bedrock. Catálogos específicos de plataforma, migración visible de modelos retirados, parámetros de razonamiento documentados y estado de conversación ligado a proveedor/modelo. Las herramientas multimedia requieren autorización y sus propias credenciales API. [Configuración y fuentes oficiales](../guides/PROVIDERS.md).

La revisión previa a publicación corrige en Bedrock la ejecución de IDs duplicados y conserva bloques protegidos, incluidos bytes redactados, al serializar el historial. La integración incorpora el main actual sin retroceder SDKs ni el workflow verificado de publicación.

## Seguridad y compatibilidad

La auditoría inicial detectó 25 avisos de dependencias de producción, incluidos dos críticos. Se actualizan simple-git 4.0.2, Undici 7.30.0 y brace-expansion 5.0.12. La auditoría posterior devuelve cero avisos. Simple-git 4 elimina la exportación por defecto: Coco utiliza exportaciones nombradas; requiere comprobar también operaciones Git reales en un repositorio sintético aislado.

## Entrega y verificación

Antes del tag: gate completo (tipos, lint, formato, cobertura, REPL y build), empaquetado único, instalación limpia, smoke de CLI/exports/runtime y Git real. Actions repetirá el gate sobre el commit del tag y publicará el tarball que verifica; se comprobarán integridad, instalación desde npm y canal. El resultado por canal se registra en la release de GitHub al terminar. No se publica VSIX ni Marketplace en esta entrega.

No se afirma acceso real validado a todas las APIs de pago, cuentas, regiones o deployments. Continúa pendiente la promoción estable documentada en REMAINING_DELIVERIES.md. Recuperación: instalar `@corbat-tech/coco@2.42.0-rc.2` o la estable `@corbat-tech/coco@2.41.0`; conservar versiones y tags inmutables. Una corrección posterior tendrá versión nueva.
