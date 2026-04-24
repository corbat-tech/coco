# LLM Providers Guide

Complete guide for configuring LLM providers with Corbat-Coco.

## Recommended Providers

### ✅ Claude (Anthropic) - RECOMMENDED

**Best for:** Production use, COCO mode, complex tool calling

**Models:**
- `claude-sonnet-4-20250514` - Fast, excellent for most tasks
- `claude-opus-4-20250514` - Most capable, best for complex projects

**Why we recommend Claude:**
- ✅ Reliable tool calling
- ✅ Follows complex system prompts (COCO mode)
- ✅ Stable streaming
- ✅ Accurate data extraction
- ✅ Strong code generation

**Configuration:**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

```json
{
  "provider": {
    "type": "anthropic",
    "model": "claude-sonnet-4-20250514"
  }
}
```

### ⚠️ OpenAI - Compatible

**Models:**
- `gpt-4o` - Multimodal, good performance
- `gpt-4-turbo` - Fast, cost-effective

**Configuration:**
```bash
export OPENAI_API_KEY="sk-..."
```

```json
{
  "provider": {
    "type": "openai",
    "model": "gpt-4o",
    "baseUrl": "https://api.openai.com/v1"
  }
}
```

### 🔧 Local Models (LM Studio, Ollama)

**Best for:** Privacy, experimentation, offline development

**Supported:**
- Qwen models (via LM Studio)
- DeepSeek models
- Llama models (via Ollama)

**Configuration:**
```bash
# LM Studio (default port 1234)
export OPENAI_BASE_URL="http://localhost:1234/v1"
export OPENAI_API_KEY="lm-studio"

# Ollama (default port 11434)
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_API_KEY="ollama"
```

```json
{
  "provider": {
    "type": "openai",
    "model": "qwen/qwen-2.5-coder-32b",
    "baseUrl": "http://localhost:1234/v1"
  }
}
```

**Note:** Local models have varying quality. Test thoroughly with COCO mode.

## Not Recommended

### ❌ Kimi/Moonshot - NOT RECOMMENDED for COCO Mode

**Why NOT recommended:**

1. **Unreliable Tool Calling**
   - Frequently hallucinates data instead of using tool results
   - JSON parsing errors in streaming responses
   - Timeouts and stuck streams

2. **COCO Mode Incompatibility**
   - Struggles with iterative quality loops
   - May skip verification steps
   - Produces inferior results despite claiming success

3. **Data Accuracy Issues**
   - Generates plausible but incorrect data
   - Example: Generated temperatures of 39-70°C for Gijón in February (should be ~14°C)
   - Doesn't verify tool call results

**When it might be acceptable:**
- ⚠️ Simple text generation (no tool calling)
- ⚠️ Prototypes where accuracy isn't critical
- ⚠️ Conversational tasks without data verification

**Configuration (if you must use it):**
```bash
export KIMI_API_KEY="..."  # or MOONSHOT_API_KEY
```

```json
{
  "provider": {
    "type": "openai",
    "model": "moonshot-v1-8k",
    "baseUrl": "https://api.moonshot.cn/v1"
  }
}
```

**IMPORTANT:** If using Kimi, **disable COCO mode** or expect poor results:
```bash
coco  # Start REPL
/quality off  # Disable COCO mode
```

## New Providers (v2.0.0)

### ⚡ Groq — Ultra-Fast Inference

**Best for:** Speed-critical tasks, rapid prototyping

**Models:** `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768`

**Free tier:** Yes (generous rate limits)

**Setup:**
```bash
export GROQ_API_KEY="gsk_..."
```

```json
{
  "provider": {
    "type": "groq",
    "model": "llama-3.3-70b-versatile"
  }
}
```

> **Note:** Groq is the fastest API available (up to 500 tok/s). COCO mode works well with `llama-3.3-70b`.

---

### 🔀 OpenRouter — Model Aggregator

**Best for:** Trying many models through a single API key

**Models:** Any model from OpenRouter's catalog (Claude, GPT-4, Llama, Mistral, etc.)

**Free tier:** Yes (several free models available)

**Setup:**
```bash
export OPENROUTER_API_KEY="sk-or-..."
```

```json
{
  "provider": {
    "type": "openrouter",
    "model": "anthropic/claude-sonnet-4-5"
  }
}
```

> Prefix model IDs with provider: `anthropic/`, `openai/`, `meta-llama/`, etc.

---

### 🌊 Mistral AI

**Best for:** European data-residency requirements, cost-efficiency

**Models:** `mistral-large-latest`, `mistral-small-latest`, `codestral-latest`

**Free tier:** Yes (via La Plateforme)

**Setup:**
```bash
export MISTRAL_API_KEY="..."
```

```json
{
  "provider": {
    "type": "mistral",
    "model": "mistral-large-latest"
  }
}
```

> **`codestral-latest`** is optimised for code generation and often outperforms larger general models.

---

### 🔵 DeepSeek

**Best for:** Maximum quality at minimal cost

**Models:** `deepseek-chat`, `deepseek-reasoner`

**Free tier:** Trial credits on sign-up

**Setup:**
```bash
export DEEPSEEK_API_KEY="sk-..."
```

```json
{
  "provider": {
    "type": "deepseek",
    "model": "deepseek-chat"
  }
}
```

> DeepSeek V3/R1 offer near-GPT-4-class quality at ~10× lower cost. `deepseek-reasoner` is the reasoning model (equivalent to R1).

---

### 🤝 Together AI

**Best for:** Open-source models, fine-tuning, batch inference

**Models:** `meta-llama/Llama-3.3-70B-Instruct-Turbo`, `Qwen/Qwen2.5-Coder-32B-Instruct`

**Free tier:** Yes ($25 trial credits)

**Setup:**
```bash
export TOGETHER_API_KEY="..."
```

```json
{
  "provider": {
    "type": "together",
    "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo"
  }
}
```

---

### 🤗 Hugging Face Inference API

**Best for:** Experimenting with community models

**Models:** Any model with inference API support

**Free tier:** Yes (serverless, rate-limited)

**Setup:**
```bash
# Either variable is accepted:
export HF_TOKEN=your-key       # recommended (standard HuggingFace name)
export HUGGINGFACE_API_KEY=your-key  # also works
```

```json
{
  "provider": {
    "type": "huggingface",
    "model": "Qwen/Qwen2.5-Coder-32B-Instruct"
  }
}
```

## COCO Mode Compatibility Matrix

| Provider | COCO Mode | Tool Calling | Data Accuracy | Recommendation |
|----------|-----------|--------------|---------------|----------------|
| Claude (Anthropic) | ✅ Excellent | ✅ Excellent | ✅ Excellent | **RECOMMENDED** |
| OpenAI GPT-4 | ✅ Very Good | ✅ Very Good | ✅ Very Good | Good |
| Groq (Llama 3.3) | ✅ Good | ✅ Good | ✅ Good | Good |
| DeepSeek V3 | ✅ Good | ✅ Good | ✅ Good | Good |
| Mistral Large | ⚠️ Variable | ✅ Good | ✅ Good | Test First |
| OpenRouter | ⚠️ Depends on model | ⚠️ Depends on model | ⚠️ Depends on model | Test First |
| Together / HF | ⚠️ Variable | ⚠️ Variable | ⚠️ Variable | Test First |
| Local (Qwen/DeepSeek) | ⚠️ Variable | ⚠️ Variable | ⚠️ Variable | Test First |
| Kimi/Moonshot | ❌ Poor | ❌ Poor | ❌ Poor | **NOT RECOMMENDED** |

## Reasoning Modes

Many models support extended reasoning (also called "thinking") — a mode where the model performs extra computation before producing its answer. Coco exposes this through the `/thinking` command (aliases `/think`, `/reason`).

### How to use it

```
/thinking              # interactive arrow-key selector
/thinking off          # disable reasoning
/thinking auto         # provider default / dynamic budget
/thinking low          # minimal reasoning
/thinking medium       # balanced reasoning
/thinking high         # maximum reasoning
/thinking 8000         # explicit token budget (Anthropic / Gemini only)
```

The active mode is always visible in the status bar and the startup panel:
```
anthropic/claude-opus-4-6/high   ← provider/model/mode
🧠 reasoning: high  ·  /thinking to change
```

### Per-provider behavior

| Provider | Models | Kind | API parameter | Default |
|----------|--------|------|---------------|---------|
| **Anthropic** | claude-3-7-sonnet, claude-opus-4, claude-sonnet-4, claude-haiku-4-5, claude-4+ | budget | `thinking.budget_tokens` (+ `temperature: 1`) | `off` |
| **OpenAI Chat Completions** | o1, o3, o4-mini, gpt-5+ | effort | `reasoning_effort: "low\|medium\|high"` | `medium` |
| **OpenAI Responses API** | same o-series / gpt-5+ models | effort | `reasoning.effort: "low\|medium\|high"` | `medium` |
| **Gemini** | gemini-2.5-pro, gemini-2.5-flash, gemini-3+ | budget | `thinkingConfig.thinkingBudget` (-1=auto, 0=off) | `auto` |
| **Kimi** | kimi-k2.5, kimi-k2-0324, kimi-latest | toggle | `thinking.type: "enabled\|disabled"` | `off` |
| **Copilot (Claude models)** | claude-* via Copilot endpoint | — | not supported | — |
| **Other providers** | gpt-4o, claude-3-5-sonnet, gemini-1.5, etc. | — | not supported | — |

**Budget levels** map to token budgets:

| Level | Anthropic | Gemini |
|-------|-----------|--------|
| `low` | 2 048 tokens | 2 048 tokens |
| `medium` | 8 000 tokens | 8 000 tokens |
| `high` | 16 000 tokens | 16 000 tokens |
| `auto` | 8 000 tokens (default) | dynamic (model decides) |

### Persistence

Your explicit choice (including `off`) is saved per provider in `~/.coco/config.json` under `providerThinking` and restored on next startup. If you have never set a preference for a provider, Coco uses the model's sensible default (e.g. `medium` for o3, `auto` for Gemini 2.5, `off` for Anthropic).

> **Kimi warning**: enabling thinking on Kimi models may cause tool-calling errors. If you experience issues, run `/thinking off` to restore default behavior.

## Provider Auto-Switch (Opt-In)

Corbat-Coco can switch providers automatically after repeated provider failures, but this is **disabled by default**.

Why default is off:
- Avoid unexpected cost changes (different providers/models have different pricing).
- Preserve explicit user control over routing and compliance requirements.

Enable explicitly only if desired:

```json
{
  "agent": {
    "enableAutoSwitchProvider": true
  }
}
```

When disabled (default), Coco will suggest `/provider` or `/model` after repeated provider errors instead of switching automatically.

## Testing Your Provider

After configuring a new provider, test with this simple task:

```bash
coco  # Start REPL

# Test basic tool calling
> Create an HTML file with today's date and temperature in Celsius.
> Use web search to get real data. Name it test-weather.html
```

**Expected behavior with good provider:**
1. Calls `web_search` tool for weather data
2. Calls `web_fetch` to get specific forecast
3. Extracts real temperature data (e.g., 14°C for winter)
4. Creates HTML with **correct** data
5. If COCO mode is on, may iterate to verify quality

**Red flags (bad provider):**
1. Generates HTML without calling tools
2. Invents fake data (e.g., 45°C in winter)
3. Claims to have fetched data but shows wrong values
4. Timeouts or JSON parsing errors
5. Completes instantly without quality loops

## Provider-Specific Timeouts

Corbat-Coco automatically adjusts timeouts based on provider:

```typescript
// Kimi/Moonshot: 10s (fast timeout due to unreliability)
// Others: 120s (standard timeout)
```

**If you experience timeouts with Claude/OpenAI:**
```json
{
  "provider": {
    "timeout": 180000  // 3 minutes
  }
}
```

## Troubleshooting

### "Model not found" error

**Cause:** Model name doesn't match provider's available models

**Fix:**
```bash
# For OpenAI-compatible APIs, list available models
curl http://localhost:1234/v1/models

# Update config with correct model ID
```

### Streaming timeouts

**Cause:** Provider is slow or stuck

**Fix:**
1. Increase timeout in config
2. Check provider health
3. Try different model
4. Switch to recommended provider (Claude)

### Tool calls not executing

**Cause:** Model doesn't support function calling or is hallucinating

**Fix:**
1. Verify model supports function calling
2. Check provider documentation
3. Switch to Claude (best tool calling support)

### COCO mode produces poor results

**Cause:** Model can't follow complex iterative prompts

**Fix:**
1. Switch to Claude Sonnet/Opus
2. Disable COCO mode: `/quality off`
3. Manually verify results

## Cost Considerations

Approximate costs per 1M tokens (input/output):

| Provider | Model | Input | Output | Notes |
|----------|-------|-------|--------|-------|
| Anthropic | Sonnet 4.6 | $3 | $15 | **Best quality** |
| Anthropic | Opus 4.6 | $15 | $75 | Most capable |
| OpenAI | GPT-4.1 | $2 | $8 | Competitive |
| DeepSeek | V3 | $0.14 | $0.28 | **Best value** |
| Groq | Llama 3.3 70B | $0.05 | $0.08 | Fastest |
| Mistral | Large | $0.25 | $0.75 | Good EU option |
| Together | Llama 3.3 70B | $0.20 | $0.20 | Open source |
| Hugging Face | Various | $0 | $0 | Free tier |
| Local | Any | $0 | $0 | Free but slower |
| Kimi | Moonshot | ¥12/M | ¥12/M | Unreliable |

**COCO mode cost impact:**
- COCO mode typically uses 2-5x more tokens (multiple iterations)
- But produces higher quality results
- With Claude Sonnet: ~$0.05-0.20 per feature (reasonable)
- With Kimi: Cheaper but may produce incorrect code

**Recommendation:** Don't sacrifice quality for cost. Claude Sonnet provides best quality/cost ratio.

## API Key Environment Variables

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Claude (Anthropic) |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google Gemini |
| `GROQ_API_KEY` | Groq |
| `OPENROUTER_API_KEY` | OpenRouter |
| `MISTRAL_API_KEY` | Mistral AI |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `TOGETHER_API_KEY` | Together AI |
| `HF_TOKEN` | Hugging Face (primary — standard HF CLI name) |
| `HUGGINGFACE_API_KEY` | Hugging Face (alias — also accepted) |
| `KIMI_API_KEY` | Moonshot/Kimi |

---

## Model Tier System

Coco automatically detects the capability tier of the active model (`mini`, `standard`, or `advanced`) and adjusts its behavior accordingly.

| Tier | Examples | Max tools | Parallel calls | Compaction at | CoT prompts |
|------|----------|-----------|----------------|---------------|-------------|
| mini | gpt-4o-mini, claude-haiku, gemini-flash, codex-mini | 12 | off | 50% context | disabled |
| standard | claude-sonnet, gpt-4o, gemini-pro | 40 | on | 75% context | enabled |
| advanced | claude-opus, gpt-5+, gemini-ultra | 128 | on | 80% context | enabled |

**Why this matters:**
- Mini models get fewer tools to prevent wrong-tool selection errors
- Parallel tool calls are disabled for mini models (they're less reliable with concurrent calls)
- Context is compacted earlier for mini models, which suffer "context rot" sooner
- Chain-of-thought system prompt sections are omitted for mini models (CoT hurts small models)

### Weak and Editor Models

You can offload cheaper background work to a fast, inexpensive model while keeping the strong model for reasoning:

```bash
# Use a cheap model for context compaction summaries
COCO_WEAK_MODEL=gpt-4o-mini coco chat

# Use a cheap model for file edit operations (architect/editor split)
COCO_EDITOR_MODEL=gpt-4o-mini coco chat

# Or pass via CLI flags
coco chat --weak-model gpt-4o-mini --editor-model gpt-4o-mini
```

These models use the same provider as the main model. The `COCO_WEAK_MODEL` is used for context compaction summaries; `COCO_EDITOR_MODEL` is stored in session config for future routing of file write/edit operations.

---

## GitHub Copilot on Corporate Networks

If Coco shows "Requires active Copilot subscription" or "Network error reaching GitHub" on a corporate machine where `gh` CLI and other tools work fine, the issue is almost certainly a **PAC proxy script**.

**Root cause:** Corporate networks often use Proxy Auto-Config (PAC) scripts to route traffic. Node.js/undici (Coco's HTTP client) cannot evaluate PAC scripts — it sees no proxy and connects directly, which the corporate firewall blocks. Go's HTTP client (used by `gh`) CAN evaluate PAC scripts.

**Fix:** Coco automatically falls back to `gh api /copilot_internal/v2/token` when the direct API call fails. This routes the token exchange through `gh`'s Go HTTP client, which respects PAC proxies.

**Prerequisites:**
1. Install `gh` CLI: `brew install gh` (macOS) or `winget install gh` (Windows)
2. Authenticate: `gh auth login`
3. Verify: `gh api /copilot_internal/v2/token` — should return a JSON token

**If the fallback also fails:**
- Check if your corporate proxy requires explicit `HTTPS_PROXY` config in Node.js: `HTTPS_PROXY=http://proxy.corp.com:8080 coco chat`
- Run `scutil --proxy` (macOS) to see if a PAC URL is configured
- Ask your IT team for the explicit proxy URL (PAC scripts cannot be evaluated programmatically)

**Corporate 403 errors:** If GitHub returns 403 (not a network timeout), Coco now tries the `gh` fallback before treating it as a permanent auth failure. This handles corporate proxies that return 403 instead of TCP-level blocking.

---

**See also:**
- [Configuration Guide](CONFIGURATION.md)
- [COCO Mode Analysis](../../ANALISIS_COCO_MODE.md)
- [Troubleshooting](TROUBLESHOOTING.md)
