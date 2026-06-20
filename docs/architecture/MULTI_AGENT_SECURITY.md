# Multi-Agent Security Model

Coco treats multi-agent execution as privileged orchestration, not as ordinary
chat. Every agent run must be evaluated across four dimensions: role,
capability, tool risk, and provenance.

## Threats

- Prompt injection: user or repository content asks an agent to ignore system,
  developer, policy, or guardrail instructions.
- Tool misuse: an agent requests shell, filesystem, git, network, secrets, or
  MCP tools outside its declared capability.
- Privilege escalation: a read-only agent delegates to a write-capable,
  destructive, or secrets-sensitive subagent.
- Insecure output handling: untrusted model output becomes code, shell input, or
  configuration without validation.
- Model denial of service: unbounded turns, tokens, retries, fan-out, or
  parallelism.
- Secret exposure: tokens, credentials, private keys, customer data, or hidden
  prompts leak into agent context or artifacts.
- Supply-chain/tool poisoning: external tools, MCP servers, packages, or docs
  alter agent behavior or exfiltrate data.

## Controls

- `AgentCapability` declares allowed tools, risk level, model settings, budget,
  and guardrail policy.
- `evaluateAgentToolPolicy` rejects tools not declared for the role or tools
  whose manifest risk exceeds the agent capability.
- Runtime permission policy evaluates `spawnSimpleAgent` by the requested
  subagent capability, so write/destructive subagents are not silently treated as
  read-only.
- `SharedWorkspaceStore` requires provenance for writes and filters sensitive
  risk context from ordinary implementation roles.
- Guardrails flag prompt-injection, tool-exfiltration, privilege-escalation, and
  credential-exfiltration patterns.
- Graph execution records correlated workflow, graph, agent, artifact, and gate
  events for replay and audit.

## Required Review Gates

Production multi-agent workflows should include these gates before destructive
or publishing actions:

- tests,
- coverage,
- security,
- review,
- quality score,
- human approval for destructive, secrets-sensitive, publish, push, merge, or
  deploy operations.
