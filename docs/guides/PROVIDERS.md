# LLM Providers Guide

This guide explains how Coco selects providers and models. The runtime source of
truth is [`src/providers/catalog.ts`](../../src/providers/catalog.ts).

## Update Rule

Do not update provider defaults in multiple files by hand. Add or update model
metadata in `src/providers/catalogs/<provider>.ts` (exposed by `src/providers/catalog.ts`), then let consumers derive:

- CLI provider model lists.
- Environment defaults.
- Context windows.
- Pricing entries.
- Capability metadata.

Only keep provider-specific transport behavior in the adapter files under
`src/providers/`.

## Verification Sources

Use official documentation or runtime discovery only:

- OpenAI public API: <https://platform.openai.com/docs/models> and
  <https://developers.openai.com/api/docs/models>
- OpenAI Codex OAuth models: <https://developers.openai.com/codex/models>
- Anthropic API: <https://docs.anthropic.com/en/docs/about-claude/models/overview>
- Anthropic deprecations:
  <https://docs.anthropic.com/en/docs/about-claude/model-deprecations>
- Gemini Developer API: <https://ai.google.dev/gemini-api/docs/models>
- Vertex AI Gemini: Google Cloud Vertex AI model docs.
- GitHub Copilot models:
  <https://docs.github.com/copilot/reference/ai-models/supported-models>
- Local providers: user-installed model catalog or local API discovery.

If a model cannot be verified, keep compatibility only when users may already
have it configured, mark it `legacy` or `deprecated`, and avoid recommending it.

## Current Defaults

These are derived from the catalog:

| Provider | Default model | Notes |
| --- | --- | --- |
| `bedrock` | `anthropic.claude-sonnet-5-5` | AWS region + authorized model/profile; AWS credentials or bearer token. |
| `ollama` | `llama3.2` | Platform-specific catalog and capabilities. |
| `kimi-code` | `kimi-for-coding` | Platform-specific catalog and capabilities. |
| `together` | `moonshotai/Kimi-K3` | Platform-specific catalog and capabilities. |
| `azure-openai` | `gpt-6.1-sol` | Requires endpoint + deployment; API key or Azure credential chain. |
| `kimi` | `kimi-k3` | Platform-specific catalog and capabilities. |
| `anthropic` | `claude-sonnet-5-5` | Platform-specific catalog and capabilities. |
| `xai` | `grok-4.7` | Platform-specific catalog and capabilities. |
| `huggingface` | `meta-llama/Llama-3.1-70B-Instruct` | Router /v1 endpoint; live model discovery. |
| `qwen` | `qwen3.8-max` | Platform-specific catalog and capabilities. |
| `deepseek` | `deepseek-flash` | Platform-specific catalog and capabilities. |
| `openai` | `gpt-6.1-sol` | Platform-specific catalog and capabilities. |
| `groq` | `openai/gpt-oss-120b` | Platform-specific catalog and capabilities. |
| `vertex` | `gemini-3.5-flash` | Independent Google Cloud catalog and credentials. |
| `gemini` | `gemini-3.8-flash` | Developer API; older 2.5 models have existing-customer restrictions. |
| `copilot` | `claude-sonnet-4.6` | Account-dependent IDs and limits; recent models may roll out progressively. |
| `openrouter` | `anthropic/claude-sonnet-5.5` | Live /models discovery supplements verified defaults. |
| `lmstudio` | `local-model` | Platform-specific catalog and capabilities. |
| `codex` | `gpt-6.1-sol` | Platform-specific catalog and capabilities. |
| `minimax` | `MiniMax-M3` | Platform-specific catalog and capabilities. |
| `mistral` | `mistral-large-4-0` | Large 4 preview is explicitly experimental. |
| `cerebras` | `qwen-3.8-27b` | Platform-specific catalog and capabilities. |

## Provider Boundaries

Keep these boundaries explicit in code and docs:

- `openai` is the public API-key flow.
- `codex` is the Codex OAuth flow and may expose a different model set.
- `anthropic` direct model IDs are not the same as Copilot model IDs.
- `gemini` Developer API and `vertex` share Gemini families but use different
  auth, endpoints, and sometimes model availability.
- `copilot` should prefer runtime discovery when credentials exist, with the
  static catalog as a conservative fallback.
- OpenAI-compatible providers still need their own defaults and compatibility
  notes because context windows, tool calling, streaming, and pricing differ.

## Reasoning / Thinking Compatibility

Do not infer reasoning support from the model name alone. Capability is
provider-specific:

- `openai` may use Responses API and OpenAI `reasoning`/`reasoning_effort` for
  supported reasoning models.
- OpenAI-compatible providers such as `groq`, `openrouter`, `mistral`,
  `deepseek`, `together`, `huggingface`, and `qwen` must not receive
  OpenAI-specific reasoning parameters unless the endpoint/model combination has
  been explicitly verified.
- `copilot` uses the Copilot endpoint and should not be treated as the public
  OpenAI API, even when the model ID starts with `gpt-5`.
- Claude 4.6+ direct Anthropic models use adaptive thinking
  (`thinking: { type: "adaptive" }`) plus `output_config.effort`; older Claude
  thinking models use fixed `budget_tokens`.
- Gemini 3 models use `thinkingLevel`; Gemini 2.5 models use
  `thinkingBudget`. Do not send both in one request.
- `/thinking` should expose only modes supported by the current provider/model
  capability.
- Interactive `/model` may prompt for thinking immediately after model
  selection. Direct `/model <id>` remains non-interactive and users can run
  `/thinking` explicitly.

## Compatibility Policy

- Never remove Claude files or Claude-specific metadata when updating Codex or
  shared agent instructions.
- Do not duplicate `CLAUDE.md` into `AGENTS.md`; `AGENTS.md` is an index for
  agents that read that file.
- Remove deprecated/retired models from selectable catalogs. Preserve official, platform-specific replacements in `src/providers/model-lifecycle.ts`. Saved configurations and direct `/model <id>` selections migrate with a warning. Unknown custom IDs remain unchanged.
- Mark experimental or preview models explicitly.
- Record `source.url` and `source.verifiedAt`; do not copy limits/prices across platforms.

## Smoke Checks

Run these after provider changes:

```bash
pnpm test src/providers/catalog.test.ts src/providers/pricing.test.ts src/config/env.test.ts src/cli/repl/providers-config.test.ts
pnpm check
```

## October 2026 transport update

Verified against official documentation on 2026-10-07. The catalog now contains
22 providers. Sources and verification dates accompany individual model entries;
older retained entries keep their earlier date rather than claiming a fresh audit.

- OpenAI GPT-6 and xAI Grok 4.7 use stateless Responses for tools. Encrypted
  reasoning items are retained for tool round trips on the same platform/model.
- Claude 5 families use adaptive thinking with model-specific effort levels.
  Sonnet 5.5 uses `between_tools` when upfront thinking is off; Haiku 5.5 uses
  `disabled`. Opus/Fable require reasoning. Signed and redacted blocks are replayed
  only to their originating provider/model.
- Gemini conversation adapters retain the supported GenerateContent contract.
  Gemini 3 effort and 2.5 budgets remain separate, with scoped thought signatures.
  Vertex 2.5 models retire on October 20, 2026 and migrate to Gemini 3.8 Flash;
  Gemini Developer API 2.5 models remain available to existing customers.
- MiniMax, Kimi, DeepSeek and Cerebras retain `reasoning_content` during tool use.
  Their request flags and effort values are provider-specific. Unsupported
  parallel-tool parameters are omitted for MiniMax/Cerebras.
- Mistral typed thinking/text content is normalized to visible text.
- Azure uses OpenAI v1, Azure credentials and a deployment name in the wire request.
  Set `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and either an API key
  or `AZURE_OPENAI_AUTH_MODE=identity`. `AZURE_OPENAI_MODEL` identifies capabilities;
  it must match the model deployed by the administrator.
- Bedrock uses the native AWS Converse/ConverseStream API, never a guessed OpenAI
  endpoint. Configure `AWS_REGION`; the default credential chain supports profiles,
  roles and environment credentials. `AWS_BEARER_TOKEN_BEDROCK` is also supported.
  `AWS_BEDROCK_AUTH_MODE=identity` explicitly selects the credential chain.
  Custom inference profile IDs can be selected directly; their capabilities require
  verification separately from the standard model catalog.
- `/model` discovers current OpenRouter and Hugging Face listings with a bounded
  request and falls back to static entries if discovery fails. OpenRouter discovery
  filters for tool-capable text output; listing is not proof of account access.

Prices are estimates. Long-context tiers are included where documented. Unverified
catalog rates (including regional Bedrock/Azure rates) display as unknown rather
than inheriting another vendor's price. A runtime USD budget rejects an unavailable
estimate; token budgets remain usable. Subscription cost estimates exclude plan fees,
quotas and premium-request multipliers.

## Images and audio files

`generate_image` generates PNGs or edits reference images through OpenAI Images
(default `gpt-image-2.5-sunburst`) or Gemini Interactions
(default `gemini-nano-banana-2.1`). `read_audio` uses OpenAI transcription followed
by the configured conversational provider, or Gemini's native audio analysis.
The active OpenAI/Gemini provider is used when applicable. With another active
provider, select the media provider explicitly or configure:

```json
{
  "media": {
    "image": { "provider": "openai", "model": "gpt-image-2.5-sunburst" },
    "audio": { "provider": "gemini", "model": "gemini-3.8-flash" }
  }
}
```

Media routes require their own API credentials. Codex/Copilot subscriptions do not
provide these API permissions. Image, audio and image-reading tools require runtime
confirmation because they upload local files. Inputs stay within the project,
reject links/oversized files, and generated images never overwrite an existing file.
PNG output defaults to `.coco/artifacts/media/`. Images accept up to 10 references;
audio files are limited to 25 MB. API costs are separate from text-token estimates.
Cancellation is forwarded and incomplete results are rejected.

## Official references for the update

- [OpenAI models](https://developers.openai.com/api/docs/models) and
  [deprecations](https://developers.openai.com/api/docs/deprecations).
- [Anthropic model lifecycle](https://platform.claude.com/docs/en/about-claude/model-deprecations).
- [Gemini models](https://ai.google.dev/gemini-api/docs/models) and
  [lifecycle](https://ai.google.dev/gemini-api/docs/deprecations).
- [GitHub Copilot supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models).
- [xAI model catalog](https://docs.x.ai/developers/models).
- [DeepSeek updates](https://api-docs.deepseek.com/updates/).
- [Azure OpenAI v1](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/api-version-lifecycle).
- [Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html).
- [Hugging Face discovery](https://huggingface.co/docs/inference-providers/main/hub-api).
- [OpenRouter discovery](https://openrouter.ai/docs/api/api-reference/models/get-models).

The automated tests use simulated responses, including transport fixtures and file
security cases. They do not establish live access for every account, region, quota
or deployment. Validate the chosen model with the actual account before production.
