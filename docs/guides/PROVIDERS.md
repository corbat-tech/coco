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
/coco off  # Disable COCO mode
```

## COCO Mode Compatibility Matrix

| Provider | COCO Mode | Tool Calling | Data Accuracy | Recommendation |
|----------|-----------|--------------|---------------|----------------|
| Claude (Anthropic) | ✅ Excellent | ✅ Excellent | ✅ Excellent | **RECOMMENDED** |
| OpenAI GPT-4 | ✅ Very Good | ✅ Very Good | ✅ Very Good | Good |
| Local (Qwen/DeepSeek) | ⚠️ Variable | ⚠️ Variable | ⚠️ Variable | Test First |
| Kimi/Moonshot | ❌ Poor | ❌ Poor | ❌ Poor | **NOT RECOMMENDED** |

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
2. Disable COCO mode: `/coco off`
3. Manually verify results

## Cost Considerations

Approximate costs per 1M tokens (input/output):

| Provider | Model | Input | Output | Notes |
|----------|-------|-------|--------|-------|
| Anthropic | Sonnet 4 | $3 | $15 | **Best value** |
| Anthropic | Opus 4 | $15 | $75 | Most capable |
| OpenAI | GPT-4o | $2.50 | $10 | Competitive |
| Local | Any | $0 | $0 | Free but slower |
| Kimi | Moonshot | ¥12/M | ¥12/M | Cheap but unreliable |

**COCO mode cost impact:**
- COCO mode typically uses 2-5x more tokens (multiple iterations)
- But produces higher quality results
- With Claude Sonnet: ~$0.05-0.20 per feature (reasonable)
- With Kimi: Cheaper but may produce incorrect code

**Recommendation:** Don't sacrifice quality for cost. Claude Sonnet provides best quality/cost ratio.

---

**See also:**
- [Configuration Guide](CONFIGURATION.md)
- [COCO Mode Analysis](../../ANALISIS_COCO_MODE.md)
- [Troubleshooting](TROUBLESHOOTING.md)
