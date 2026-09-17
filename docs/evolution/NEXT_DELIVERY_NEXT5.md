# next.5 — evidencia de calidad y referencia Ollama

Estado: **publicado y verificado**. Commit `e367cc0`, tag `v2.42.0-next.5`. Base: `2.42.0-next.4`.

## Alcance

- La evaluación distingue `measured`, `not_applicable`, `unavailable` y `error`; una puntuación parcial no autoriza aceptación.
- Separación entre requisitos cumplidos y convergencia. Pruebas, revisión y evaluación deben corresponder al mismo contenido; una modificación invalida la evidencia.
- Cobertura generada en un directorio único por ejecución, sin reutilizar informes antiguos. Comandos de análisis acotados y cancelables; ausencia de instrumentos no equivale a éxito.
- `calculate_quality` vuelve como informe de evidencia, con limitaciones explícitas. La certificación soporta JavaScript/TypeScript; los adaptadores de otros lenguajes siguen disponibles pero no certifican silenciosamente mediante resultados incompletos.

## Referencia real local

Ollama 0.34.1, sin descarga de modelos ni llamadas a proveedores de pago. Se utilizó el paquete instalado next.4, runtime y seis herramientas de archivos/shell sobre directorios sintéticos aislados. Límite por caso: 10 minutos y 30 llamadas.

| Modelo | Resultado | Observación |
| --- | --- | --- |
| qwen3.5:4b | 4/5 | `greet("   ")` devolvió `Hello ` en vez de `Hello friend`; los mensajes de prueba generados por el modelo no detectaron el defecto. |
| qwen3.5:9b | 5/5 | Pasó los verificadores externos; no demuestra capacidad general ni superioridad estadística. |

Evidencia: [4b](evidence/next4-ollama-4b-v1.json), [9b](evidence/next4-ollama-9b-v2.json). El corpus v2 endurece la comprobación de una sola pasada del refactor (lecturas de elementos, no solo de propiedades). No comparar estos resultados como una mejora de Coco: ambos ejecutan next.4 y usan modelos distintos. Los tokens v1 reflejan solo la última respuesta; v2 agrega las respuestas del proveedor.

El caso de sesión inicial contiene dos turnos. La prueba prolongada de contexto y las dos repeticiones comparables siguen en next.8. Todavía no se ha probado aquí el REPL completo, la extensión ni herramientas ajenas al conjunto declarado.

## Revisión independiente

La revisión encontró y se corrigieron: ESLint con salida vacía y exit 1 tratado como éxito; posible instalación implícita del medidor de cobertura; fuentes seleccionadas fuera del contenido verificado; salida paginada UTF-8 y limpieza del host (estos dos últimos pertenecen a next.6).

## Cierre pendiente

- [x] Typecheck, lint, formato y build; 8.019 pruebas principales + 27 de integración REPL. Cobertura: 70,73% statements / 71,37% líneas; todavía por debajo del objetivo final del 80%.
- [x] Empaquetado y clean install. SHA256 `74bac1f8f531c01e21acc1782cea1d4b2248e4afd23830b1471eda7fac985520`.
- [x] Actions/OIDC PASS; npm `next=2.42.0-next.5`, `latest=2.41.0` al cierre; integridad idéntica y cuatro assets GitHub.
- [x] SHA, pruebas y limitaciones registrados; next.6 en curso.

Actions: https://github.com/corbat-tech/coco/actions/runs/35261863410 . Release: https://github.com/corbat-tech/coco/releases/tag/v2.42.0-next.5 .
