/**
 * REPL Onboarding
 *
 * Interactive setup flow for first-time users or missing configuration.
 */

import * as p from '@clack/prompts';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createProvider, type ProviderType } from '../../providers/index.js';
import type { ReplConfig } from './types.js';
import { VERSION } from '../../version.js';

/**
 * Provider configuration options
 */
interface ProviderOption {
  id: string;
  name: string;
  emoji: string;
  description: string;
  envVar: string;
  models: { value: string; label: string }[];
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    emoji: '🟠',
    description: 'Best for coding tasks with Claude 3.5 Sonnet',
    envVar: 'ANTHROPIC_API_KEY',
    models: [
      { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Recommended)' },
      { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (Fastest)' },
      { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus (Most Capable)' },
      { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
      { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    emoji: '🟢',
    description: 'GPT-4o and GPT-4 models',
    envVar: 'OPENAI_API_KEY',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o (Recommended)' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast & Cheap)' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'gpt-4', label: 'GPT-4' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Cheapest)' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    emoji: '🔵',
    description: 'Google\'s Gemini 2.0 and 1.5 models',
    envVar: 'GEMINI_API_KEY',
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Recommended)' },
      { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (Fastest)' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Legacy)' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Legacy)' },
    ],
  },
  {
    id: 'kimi',
    name: 'Moonshot Kimi',
    emoji: '🌙',
    description: 'Kimi/Moonshot models (Chinese provider - OpenAI compatible)',
    envVar: 'KIMI_API_KEY',
    models: [
      { value: 'moonshot-v1-8k', label: 'Moonshot v1 8K (Default)' },
      { value: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
      { value: 'moonshot-v1-128k', label: 'Moonshot v1 128K (Long context)' },
    ],
  },
];

/**
 * Check if any provider is configured
 */
export function hasAnyApiKey(): boolean {
  const envVars = PROVIDER_OPTIONS.map((p) => p.envVar);
  return envVars.some((envVar) => process.env[envVar]);
}

/**
 * Get the first available provider from env
 */
export function getConfiguredProvider(): { type: ProviderType; model: string } | null {
  for (const provider of PROVIDER_OPTIONS) {
    if (process.env[provider.envVar]) {
      const firstModel = provider.models[0];
      return {
        type: provider.id as ProviderType,
        model: firstModel?.value || '',
      };
    }
  }
  return null;
}

/**
 * Run onboarding flow
 * Returns the configured provider or null if cancelled
 */
export async function runOnboarding(): Promise<{
  type: string;
  model: string;
  apiKey: string;
} | null> {
  console.clear();
  
  // Welcome banner
  console.log(
    chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🥥 Corbat-Coco v${VERSION}                               ║
║                                                          ║
║   Your AI Coding Agent                                    ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`)
  );

  p.log.message(chalk.dim('Welcome! Let\'s get you set up.\n'));

  // Check if there's a partially configured provider
  const existingProviders = PROVIDER_OPTIONS.filter((p) => process.env[p.envVar]);
  
  if (existingProviders.length > 0) {
    p.log.info(`Found existing API key for: ${existingProviders.map((p) => p.name).join(', ')}`);
    const useExisting = await p.confirm({
      message: 'Use existing configuration?',
      initialValue: true,
    });

    if (p.isCancel(useExisting)) {
      return null;
    }

    if (useExisting) {
      const provider = existingProviders[0];
      if (!provider) {
        return null;
      }
      const firstModel = provider.models[0];
      return {
        type: provider.id as ProviderType,
        model: firstModel?.value || '',
        apiKey: process.env[provider.envVar] || '',
      };
    }
  }

  // Select provider
  const providerChoice = await p.select({
    message: 'Choose your AI provider:',
    options: PROVIDER_OPTIONS.map((p) => ({
      value: p.id,
      label: `${p.emoji} ${p.name}`,
      hint: p.description,
    })),
  });

  if (p.isCancel(providerChoice)) {
    return null;
  }

  const selectedProvider = PROVIDER_OPTIONS.find((p) => p.id === providerChoice);
  if (!selectedProvider) {
    return null;
  }

  // Show setup instructions
  p.log.message('');
  p.log.step(`Setting up ${selectedProvider.name}`);
  
  // Provider-specific help
  const helpText: Record<string, string> = {
    anthropic: `
📝 Get your API key from: https://console.anthropic.com/
💡 Recommended: Claude 3.5 Sonnet for coding tasks
💰 New accounts get $5 free credits`,
    openai: `
📝 Get your API key from: https://platform.openai.com/api-keys
💡 Recommended: GPT-4o for best performance
💰 Requires payment method (no free tier)`,
    gemini: `
📝 Get your API key from: https://aistudio.google.com/app/apikey
💡 Recommended: Gemini 2.0 Flash (fast & capable)
💰 Generous free tier available`,
    kimi: `
📝 Get your API key from: https://platform.moonshot.cn/
💡 Uses OpenAI-compatible API format
💰 Free credits for new accounts`,
  };
  
  p.log.message(chalk.dim(helpText[selectedProvider.id] || `\nYou need an API key from ${selectedProvider.name}.`));
  p.log.message('');

  // Input API key
  const apiKey = await p.password({
    message: `Enter your ${selectedProvider.name} API key:`,
    validate: (value) => {
      if (!value || value.length < 10) {
        return 'Please enter a valid API key';
      }
      return;
    },
  });

  if (p.isCancel(apiKey)) {
    return null;
  }

  // Select model (with custom option)
  const modelOptions = [
    ...selectedProvider.models,
    { value: '__custom__', label: '✏️  Other (enter custom model name)' },
  ];
  
  let modelChoice = await p.select({
    message: 'Choose a model:',
    options: modelOptions,
  });

  if (p.isCancel(modelChoice)) {
    return null;
  }

  // Handle custom model input
  if (modelChoice === '__custom__') {
    const customModel = await p.text({
      message: 'Enter the model name:',
      placeholder: `e.g., ${selectedProvider.models[0]?.value || 'model-name'}`,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Please enter a model name';
        }
        return;
      },
    });
    
    if (p.isCancel(customModel)) {
      return null;
    }
    
    modelChoice = customModel;
  }

  // Test the API key
  p.log.message('');
  const spinner = p.spinner();
  spinner.start('Testing API key...');

  try {
    // Set env var temporarily for testing
    process.env[selectedProvider.envVar] = apiKey;
    
    const testProvider = await createProvider(selectedProvider.id as ProviderType, {
      model: modelChoice as string,
    });
    
    const available = await testProvider.isAvailable();
    
    if (!available) {
      spinner.stop('API key validation failed');
      p.log.error('❌ Could not connect to the provider.');
      p.log.message(chalk.dim('\nPossible causes:'));
      p.log.message(chalk.dim('  • Invalid API key'));
      p.log.message(chalk.dim('  • Invalid model name'));
      p.log.message(chalk.dim('  • Network connectivity issues'));
      p.log.message(chalk.dim('  • Provider service down'));
      
      const retry = await p.confirm({
        message: 'Would you like to try again?',
        initialValue: true,
      });
      
      if (retry && !p.isCancel(retry)) {
        return runOnboarding();
      }
      return null;
    }

    spinner.stop('✅ API key is valid!');
  } catch (error) {
    spinner.stop('API key validation failed');
    p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  // Ask about saving
  p.log.message('');
  const saveChoice = await p.select({
    message: 'How would you like to save this configuration?',
    options: [
      { value: 'session', label: '💨 This session only', hint: 'Key will be lost when you exit' },
      { value: 'env', label: '📝 Save to .env file', hint: 'Creates .env file in current directory' },
      { value: 'global', label: '🔧 Save globally', hint: 'Adds to your shell profile (~/.zshrc, ~/.bashrc)' },
    ],
  });

  if (p.isCancel(saveChoice)) {
    return null;
  }

  if (saveChoice === 'env') {
    await saveToEnvFile(selectedProvider.envVar, apiKey);
  } else if (saveChoice === 'global') {
    await saveToShellProfile(selectedProvider.envVar, apiKey);
  }

  // Success message
  console.log('');
  p.log.success(`✅ ${selectedProvider.name} configured successfully!`);
  p.log.message(chalk.dim(`Model: ${modelChoice}`));
  p.log.message('');
  
  const continueToRepl = await p.confirm({
    message: 'Start coding?',
    initialValue: true,
  });

  if (!continueToRepl || p.isCancel(continueToRepl)) {
    return null;
  }

  return {
    type: selectedProvider.id as ProviderType,
    model: modelChoice as string,
    apiKey,
  };
}

/**
 * Save API key to .env file
 */
async function saveToEnvFile(envVar: string, apiKey: string): Promise<void> {
  const envPath = path.join(process.cwd(), '.env');
  
  let envContent = '';
  try {
    envContent = await fs.readFile(envPath, 'utf-8');
  } catch {
    // File doesn't exist, start fresh
  }

  // Check if var already exists
  const lines = envContent.split('\n');
  const existingIndex = lines.findIndex((line) => line.startsWith(`${envVar}=`));
  
  if (existingIndex >= 0) {
    lines[existingIndex] = `${envVar}=${apiKey}`;
  } else {
    lines.push(`${envVar}=${apiKey}`);
  }

  await fs.writeFile(envPath, lines.join('\n'), 'utf-8');
  p.log.success(`Saved to ${envPath}`);
}

/**
 * Save API key to shell profile
 */
async function saveToShellProfile(envVar: string, apiKey: string): Promise<void> {
  const shell = process.env.SHELL || '';
  let profilePath: string;

  if (shell.includes('zsh')) {
    profilePath = path.join(process.env.HOME || '~', '.zshrc');
  } else if (shell.includes('bash')) {
    profilePath = path.join(process.env.HOME || '~', '.bashrc');
  } else {
    profilePath = path.join(process.env.HOME || '~', '.profile');
  }

  let profileContent = '';
  try {
    profileContent = await fs.readFile(profilePath, 'utf-8');
  } catch {
    // File doesn't exist, start fresh
  }

  // Check if var already exists
  const lines = profileContent.split('\n');
  const existingIndex = lines.findIndex((line) => line.startsWith(`export ${envVar}=`));
  
  if (existingIndex >= 0) {
    lines[existingIndex] = `export ${envVar}=${apiKey}`;
  } else {
    lines.push(`# Corbat-Coco ${envVar}`, `export ${envVar}=${apiKey}`, '');
  }

  await fs.writeFile(profilePath, lines.join('\n'), 'utf-8');
  p.log.success(`Saved to ${profilePath}`);
  p.log.message(chalk.dim('Run `source ' + profilePath + '` to apply in current terminal'));
}

/**
 * Quick config check and setup if needed
 */
export async function ensureConfigured(config: ReplConfig): Promise<ReplConfig | null> {
  // Check if we already have a working configuration
  if (hasAnyApiKey()) {
    const configured = getConfiguredProvider();
    if (configured) {
      // Test if it works
      try {
        const provider = await createProvider(configured.type, {
          model: configured.model,
        });
        const available = await provider.isAvailable();
        if (available) {
          return {
            ...config,
            provider: {
              ...config.provider,
              type: configured.type,
              model: configured.model,
            },
          };
        }
      } catch {
        // Fall through to onboarding
      }
    }
  }

  // Run onboarding
  const result = await runOnboarding();
  if (!result) {
    return null;
  }

  return {
    ...config,
    provider: {
      ...config.provider,
      type: result.type as "anthropic" | "openai" | "gemini" | "kimi",
      model: result.model,
    },
  };
}
