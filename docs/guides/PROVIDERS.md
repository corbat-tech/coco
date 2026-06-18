# LLM Providers Guide

This guide explains how Coco selects providers and models. The runtime source of
truth is [`src/providers/catalog.ts`](../../src/providers/catalog.ts).

## Update Rule

Do not update provider defaults in multiple files by hand. Add or update model
metadata in `src/providers/catalog.ts`, then let consumers derive:

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
| `anthropic` | `claude-sonnet-4-6` | Direct Anthropic API. Keep retired Claude 4 model IDs only as deprecated compatibility entries. |
| `openai` | `gpt-5.5` | Public OpenAI API, separate from ChatGPT/Codex OAuth. |
| `codex` | `gpt-5.5` | OAuth-backed Codex flow, separate from OpenAI API keys. |
| `gemini` | `gemini-3.1-pro-preview` | Gemini Developer API. |
| `vertex` | `gemini-2.5-pro` | Vertex AI transport and auth are separate from Gemini Developer API. |
| `copilot` | `claude-sonnet-4.6` | GitHub Copilot model IDs use Copilot catalog naming and may differ from direct provider IDs. |
| `kimi` | `kimi-k2.5` | Moonshot/Kimi API. |
| `kimi-code` | `kimi-for-coding` | Kimi Code auth/transport. |
| `qwen` | `qwen-coder-plus` | DashScope/Qwen API. |
| `lmstudio` | `local-model` | Local OpenAI-compatible server. |
| `ollama` | `llama3.2` | Local Ollama server. |
| `groq` | `llama-3.3-70b-versatile` | Groq API. |
| `openrouter` | `anthropic/claude-sonnet-4.6` | Aggregator; model availability can change by account and region. |
| `mistral` | `mistral-large-latest` | Mistral API. |
| `deepseek` | `deepseek-chat` | DeepSeek API. |
| `together` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Together API. |
| `huggingface` | `meta-llama/Llama-3.1-70B-Instruct` | Hugging Face Inference. |

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
- Keep deprecated model IDs when users may already have them configured, but do
  not recommend them.
- Mark experimental or preview models explicitly.
- Add `sourceUrl` and `lastVerified` when a model is based on documentation.

## Smoke Checks

Run these after provider changes:

```bash
pnpm test src/providers/catalog.test.ts src/providers/pricing.test.ts src/config/env.test.ts src/cli/repl/providers-config.test.ts
pnpm check
```
