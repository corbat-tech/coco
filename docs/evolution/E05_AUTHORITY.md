# E05 · MCP y autoridad delegada

## E05.a · DONE · 2026-09-16

El wrapper MCP asigna procedencia host (servidor/tool) a la definición. La política común trata efectos remotos desconocidos con el máximo riesgo existente, exige consentimiento en build/debug y bloquea ejecución en ask/plan/review/architect. Ni categorías alternativas, prefijos personalizados ni hints remotos convierten la tool en lectura autorizada. Las confirmaciones de tools desconocidas muestran argumentos completos.

20 casos por `/root/core_audit` (19 fallan antes, incluyendo assertions de clasificación/procedencia; no se presentan como 19 exploits distintos). Matrices usan wrapper, registry y runtime reales con cliente remoto simulado y contador de efectos. Con consumidores: 19 archivos / 454 tests correctos; typecheck/lint correctos. Logs `mcp-permission-{before,after}.log`. Implementación y prueba de UI por coordinador; revisión `/root/baseline_review`: APPROVED sin objeciones materiales.

No hay ejecución remota real ni modificación de schemas/timeouts (E07/E08). Política conservadora predeterminada: una integración host puede establecer una política explícita propia; declaraciones del servidor no bastan. Delegación pendiente, por lo que E05 no está completo. Sin publicación; rollback por revert.

## E05.b · DONE · 2026-09-16

AgentManager entrega objetos y arrays de tools al proveedor hijo como JSON; conserva strings y fallback Success para ausencia/null. Seis casos verifican el mensaje tool_result real del siguiente turno: dos fallan antes, cuatro conservan paridad. Suite de consumidores 4 archivos / 79 tests, y 45 tras extracción final del helper; typecheck/lint correctos. Logs `agent-results-{before,after,final}.log`. Coordinador implementa/tests; revisión `/root/baseline_review`: APPROVED sin hallazgos materiales. E05.a commit `0072d9a`.

Autoridad parental pendiente. Sin publicación; rollback por revert.
