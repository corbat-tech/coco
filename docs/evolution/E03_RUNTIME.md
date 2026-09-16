# E03 · Frontera de ejecución

## E03.a · DONE · 2026-09-16

AgentRuntime delega permisos y ejecución en RuntimeToolExecutor, conservando validación de tenant/sesión, precedencia de modo, decisiones y contratos de eventos. El perfil del API conserva privacidad de metadata y no añade eventos de agente. No se cambia la autoridad concedida.

Seis pruebas nuevas de caracterización pasan antes y después: aislamiento de sesiones concurrentes, rechazo de sesión desconocida antes de consultar tools, política dependiente de input, eventos, privacidad, errores de validación/ejecución y despacho único. Después: 22 archivos / 225 pruebas de runtime, agentes y swarm pasan en Node 22.23.2 aislado. Typecheck, lint y formato pasan. Logs locales: `.dev/evolution/e01-baseline/logs/runtime-{before,contract-before,after}.log`.

Revisor independiente: `/root/baseline_review`, APPROVED, sin defectos materiales. Tests de contrato aportados por `/root/core_audit`; implementación por coordinador. Rollback: revertir el commit de este incremento. Sin publicación: todavía hay bloqueantes abiertos del programa.

E03 sigue IN_PROGRESS: REPL/headless aún ejecutan por un alias del registry; la prueba de arquitectura textual no detecta esos alias. Integración, detección del bypass y matriz completa pendientes. No se declara una frontera universal todavía.
