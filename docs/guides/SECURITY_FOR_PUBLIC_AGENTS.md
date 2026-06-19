# Security For Public Agents

Public agents have a larger attack surface than local coding agents. Use least
privilege, explicit approval, isolation, and observability from the first
version.

## Defaults

- No tools by default.
- No shell, filesystem, git, deploy, package publishing, or generic MCP tools.
- Dedicated service identity for each integration.
- Redacted event logs.
- Human approval for external side effects.

## Guardrails

Coco includes basic guardrails for:

- input length;
- output length;
- secret redaction;
- prompt-injection pattern warnings;
- blocked topics;
- structured output validation.

Guardrails reduce risk, but they do not replace product-specific policy,
authentication, rate limiting, or human review.

## Deployment Checklist

- Put the assistant behind a backend, never directly in the browser.
- Validate channel signatures where available.
- Rate-limit by user/session/IP/channel.
- Store only the conversation data you need.
- Review logs for tool blocks, guardrail findings, and escalations.
- Keep risky actions in draft mode until a human approves them.
