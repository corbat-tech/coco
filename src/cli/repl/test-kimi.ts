/**
 * Test script for Kimi/Moonshot connection
 * Run with: pnpm tsx src/cli/repl/test-kimi.ts
 */

import { createKimiProvider } from "../../providers/openai.js";
import OpenAI from "openai";

async function testKimiConnection() {
  console.log("🌙 Testing Kimi/Moonshot Connection\n");

  const apiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;

  if (!apiKey) {
    console.error("❌ No API key found. Set KIMI_API_KEY or MOONSHOT_API_KEY");
    process.exit(1);
  }

  // Don't log API key to avoid clear-text logging security issue
  console.log(`API Key: [REDACTED]`);
  console.log(`Base URL: https://api.moonshot.cn/v1\n`);

  // Test 1: Direct OpenAI client
  console.log("Test 1: Direct OpenAI client connection\n");
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.moonshot.cn/v1",
    });

    console.log("  Client created, testing models.list()...");
    try {
      const models = await client.models.list();
      console.log(`  ✅ models.list() succeeded!`);
      console.log(`  Models: ${models.data.map((m) => m.id).join(", ")}`);
    } catch (e) {
      console.log(`  ❌ models.list() failed: ${e instanceof Error ? e.message : String(e)}`);

      // Try chat completion
      console.log("  Trying chat.completions.create()...");
      try {
        const response = await client.chat.completions.create({
          model: "moonshot-v1-8k",
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 10,
        });
        console.log(`  ✅ chat.completions.create() succeeded!`);
        console.log(`  Response: ${response.choices[0]?.message?.content}`);
      } catch (e2) {
        console.log(
          `  ❌ chat.completions.create() failed: ${e2 instanceof Error ? e2.message : String(e2)}`,
        );
        if (e2 instanceof Error && "status" in e2) {
          console.log(`  Status: ${(e2 as any).status}`);
        }
      }
    }
  } catch (e) {
    console.error(`  ❌ Client creation failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Test 2: Via provider
  console.log("\nTest 2: Via createKimiProvider\n");
  try {
    const provider = createKimiProvider({
      apiKey,
      model: "moonshot-v1-8k",
    });

    console.log(`  Provider: ${provider.id} - ${provider.name}`);
    console.log("  Testing isAvailable()...");

    const available = await provider.isAvailable();
    console.log(`  Result: ${available ? "✅ Available" : "❌ Not available"}`);
  } catch (e) {
    console.error(`  ❌ Provider test failed: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) {
      console.error(`  Stack: ${e.stack}`);
    }
  }

  console.log("\nDone!");
}

testKimiConnection().catch(console.error);
