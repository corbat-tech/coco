import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import {
  getAllProviders,
  getProviderDefinition,
  formatModelInfo,
} from "../repl/providers-config.js";
import type { ProviderType } from "../../providers/index.js";

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage Corbat-Coco configuration");

  configCmd
    .command("get <key>")
    .description("Get a configuration value")
    .action(async (key: string) => {
      await runConfigGet(key);
    });

  configCmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action(async (key: string, value: string) => {
      await runConfigSet(key, value);
    });

  configCmd
    .command("list")
    .description("List all configuration values")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      await runConfigList(options);
    });

  configCmd
    .command("init")
    .description("Initialize configuration interactively")
    .action(async () => {
      await runConfigInit();
    });
}

async function runConfigGet(key: string): Promise<void> {
  const config = await loadConfig();
  const value = getNestedValue(config, key);

  if (value === undefined) {
    p.log.error(`Configuration key '${key}' not found.`);
    process.exit(1);
  }

  console.log(typeof value === "object" ? JSON.stringify(value, null, 2) : String(value));
}

async function runConfigSet(key: string, value: string): Promise<void> {
  const config = await loadConfig();

  // Parse value (try JSON, fall back to string)
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(value);
  } catch {
    parsedValue = value;
  }

  setNestedValue(config, key, parsedValue);
  await saveConfig(config);

  p.log.success(`Set ${key} = ${value}`);
}

async function runConfigList(options: { json?: boolean }): Promise<void> {
  const config = await loadConfig();

  if (options.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  console.log(chalk.bold("\nCorbat-Coco Configuration:\n"));
  printConfig(config, "");
}

async function runConfigInit(): Promise<void> {
  p.intro(chalk.cyan("Corbat-Coco Configuration Setup"));

  // Select provider
  const allProviders = getAllProviders();
  const providerChoice = await p.select({
    message: "Select your AI provider:",
    options: allProviders.map((provider) => ({
      value: provider.id,
      label: `${provider.emoji} ${provider.name}`,
      hint: provider.description,
    })),
  });

  if (p.isCancel(providerChoice)) {
    p.cancel("Configuration cancelled.");
    process.exit(0);
  }

  const selectedProvider = getProviderDefinition(providerChoice as ProviderType);

  // API Key
  const apiKey = await p.password({
    message: `Enter your ${selectedProvider.name} API key:`,
    validate: (value) => {
      if (!value || value.length < 10) return "API key is required (min 10 chars)";
      return undefined;
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel("Configuration cancelled.");
    process.exit(0);
  }

  // Model selection
  const modelOptions = selectedProvider.models.map((m) => ({
    value: m.id,
    label: formatModelInfo(m),
  }));

  const model = await p.select({
    message: "Select the default model:",
    options: modelOptions,
  });

  if (p.isCancel(model)) {
    p.cancel("Configuration cancelled.");
    process.exit(0);
  }

  // Quality threshold
  const quality = await p.text({
    message: "Minimum quality score (0-100):",
    placeholder: "85",
    initialValue: "85",
    validate: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 0 || num > 100) return "Must be a number between 0 and 100";
      return undefined;
    },
  });

  if (p.isCancel(quality)) {
    p.cancel("Configuration cancelled.");
    process.exit(0);
  }

  // Save configuration
  const config = {
    provider: {
      type: providerChoice as string,
      apiKey: apiKey as string,
      model: model as string,
    },
    quality: {
      minScore: parseInt(quality as string, 10),
      minCoverage: 80,
      maxIterations: 10,
    },
  };

  await saveConfig(config);

  p.outro(chalk.green("Configuration saved to .coco/config.json"));
}

// Helper functions

type ConfigObject = Record<string, unknown>;

async function loadConfig(): Promise<ConfigObject> {
  // TODO: Load from .coco/config.json
  return {
    provider: {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
    },
    quality: {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 10,
    },
    persistence: {
      checkpointInterval: 300000,
      maxCheckpoints: 50,
    },
  };
}

async function saveConfig(config: ConfigObject): Promise<void> {
  // TODO: Save to .coco/config.json
  const fs = await import("node:fs/promises");
  await fs.mkdir(".coco", { recursive: true });
  await fs.writeFile(".coco/config.json", JSON.stringify(config, null, 2));
}

function getNestedValue(obj: ConfigObject, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as ConfigObject)[key];
  }

  return current;
}

function setNestedValue(obj: ConfigObject, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: ConfigObject = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) continue;
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as ConfigObject;
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey) {
    current[lastKey] = value;
  }
}

function printConfig(obj: unknown, prefix: string): void {
  if (obj === null || obj === undefined) {
    console.log(chalk.dim(prefix) + chalk.yellow("null"));
    return;
  }

  if (typeof obj !== "object") {
    console.log(chalk.dim(prefix) + String(obj));
    return;
  }

  for (const [key, value] of Object.entries(obj as ConfigObject)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      printConfig(value, fullKey);
    } else {
      const displayValue = typeof value === "string" && value.startsWith("sk-")
        ? chalk.dim("[hidden]")
        : chalk.cyan(JSON.stringify(value));
      console.log(`  ${chalk.dim(fullKey + ":")} ${displayValue}`);
    }
  }
}
