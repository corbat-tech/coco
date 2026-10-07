# Entrega next.7 — CLI, terminal y VSIX

Estado: publicada y verificada. La versión estable npm sigue en 2.41.0.

## Alcance implementado

- Headless: stdin máximo 1 MiB y 5 segundos absolutos; UTF-8 válido, sin ejecutar entradas parciales. Una respuesta JSON incluso ante errores de argumentos/configuración. Diagnósticos por stderr y cierre de recursos/señales.
- Terminal: actualizaciones no bloqueantes; EOF/cierre/error completan el prompt pendiente; decodificación Unicode entre fragmentos. Ajuste de ancho por grafemas/columnas y secuencias ANSI, conservando Markdown original para copiar.
- Proveedores: candidato validado antes de guardar; instancia validada reutilizada al cambiar; configuración en memoria/disco y clasificación sincronizadas; elección explícita de API key/OAuth/ADC persistida por proveedor.
- VSIX 2.42.0: ejecutable separado de argv, sin interpolar rutas en shell; multiroot, reutilización/cierre, Trust, cancelación de creación tardía. Publicación de artefacto GitHub; no se ha publicado en Marketplace.

## Evidencia previa al gate completo

- Renderer: 78 pruebas PASS, incluyendo CJK, emoji/ZWJ, combinaciones, ANSI, Markdown anidado, bloques incompletos y copia completa.
- Proveedores y configuración: 187 pruebas PASS antes del último ajuste de selección explícita en onboarding; volver a comprobar ese ajuste.
- VS Code 1.137.0 Extension Host real: PASS ejecutable/argv, ruta especial, multiroot, reuse/new session, cierre y ejecutable ausente. Perfil sintético, sin proveedores de pago.
- Rechazo de workspace no confiable: contrato automatizado y manifest. No afirmar prueba real de Restricted Mode: el host de desarrollo se inicia confiable.
- Windows: launcher .cmd/.bat no soportado; no afirmar validación de ejecución en Windows. Background continúa restringido a POSIX.

## Pendientes de cierre

- [x] Revisión independiente final del renderer y cambio de autenticación.
- [x] Gate completo del commit exacto y clean install del tarball.
- [x] Publicación OIDC de next.7, integridad y canal npm.
- [x] VSIX empaquetado, inspección y gate Linux/Extension Host en Actions.

## Publicación

- npm next.7: commit b058631, 8.124 pruebas principales +28 REPL,15 omitidas. Cobertura74,65%statements/75,36%líneas. Clean install PASS. [Actions35264727188](https://github.com/corbat-tech/coco/actions/runs/35264727188) PASS.
- npm `next=2.42.0-next.7`, `latest=2.41.0`; integridad publicada `sha512-rDSjqR3koUbt7DdZRGJA8UVGqUqrNUoNtZX4S3SVxOeU9oGBOc0ts/JYEf7pTlxHD2GhY/IckogVaNc7SblYoA==`. SHA256 GitHub `cf87ca93542683e2215d619a6d8e26d5a91e9e2ba109eb166c231113c6591b68`.
- VSIX commit251ce3b: [Actions35264727106](https://github.com/corbat-tech/coco/actions/runs/35264727106) PASS, incluido Extension Host Linux. [Descarga](https://github.com/corbat-tech/coco/releases/download/vscode-v2.42.0/corbat-coco.vsix). SHA256publicado `16d2243676e4d9cad1812e9a0763470a90bb1f398de561207732820270b15449`. Bundle comprobado, nueve archivos, sin fixtures/maps.
