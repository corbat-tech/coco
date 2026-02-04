/**
 * REPL Onboarding v2
 *
 * Sistema de configuración inspirado en OpenCode/Crush
 * - Providers flexibles con modelos actualizados
 * - Soporte para modelos personalizados
 * - Mejor manejo de errores
 */

import * as p from '@clack/prompts';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createProvider, type ProviderType } from '../../providers/index.js';
import type { ReplConfig } from './types.js';
import { VERSION } from '../../version.js';
import {
  getAllProviders,
  getProviderDefinition,
  getRecommendedModel,
  getConfiguredProviders,
  formatModelInfo,
  type ProviderDefinition,
} from './providers-config.js';

/**
 * Resultado del onboarding
 */
export interface OnboardingResult {
  type: ProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * Ejecutar flujo de onboarding completo
 */
export async function runOnboardingV2(): Promise<OnboardingResult | null> {
  console.clear();

  // Banner de bienvenida
  console.log(
    chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🥥 Corbat-Coco v${VERSION}                                  ║
║                                                          ║
║   Your AI Coding Agent                                    ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`)
  );

  p.log.message(chalk.dim("Welcome! Let's get you set up with an AI provider.\n"));

  // Paso 1: Detectar providers ya configurados
  const configuredProviders = getConfiguredProviders();

  if (configuredProviders.length > 0) {
    p.log.info(
      `Found ${configuredProviders.length} configured provider(s): ${configuredProviders
        .map((p) => p.emoji + ' ' + p.name)
        .join(', ')}`
    );

    const useExisting = await p.confirm({
      message: 'Use an existing provider?',
      initialValue: true,
    });

    if (p.isCancel(useExisting)) return null;

    if (useExisting) {
      const selected = await selectExistingProvider(configuredProviders);
      if (selected) return selected;
    }
  }

  // Paso 2: Seleccionar nuevo provider
  return await setupNewProvider();
}

/**
 * Seleccionar provider existente
 */
async function selectExistingProvider(
  providers: ProviderDefinition[]
): Promise<OnboardingResult | null> {
  const options = providers.map((p) => ({
    value: p.id,
    label: `${p.emoji} ${p.name}`,
    hint: 'Configured',
  }));

  options.push({ value: '__new__' as ProviderType, label: '➕ Setup new provider', hint: '' });

  const choice = await p.select({
    message: 'Select provider:',
    options,
  });

  if (p.isCancel(choice)) return null;
  if (choice === ('__new__' as ProviderType)) return setupNewProvider();

  const provider = getProviderDefinition(choice as ProviderType);
  const apiKey = process.env[provider.envVar] || '';

  // Seleccionar modelo
  const model = await selectModel(provider);
  if (!model) return null;

  // Testear conexión
  const valid = await testConnection(provider, apiKey, model);
  if (!valid) return null;

  return {
    type: provider.id,
    model,
    apiKey,
  };
}

/**
 * Configurar nuevo provider
 */
async function setupNewProvider(): Promise<OnboardingResult | null> {
  const providers = getAllProviders();

  const providerChoice = await p.select({
    message: 'Choose an AI provider:',
    options: providers.map((p) => ({
      value: p.id,
      label: `${p.emoji} ${p.name}`,
      hint: p.description,
    })),
  });

  if (p.isCancel(providerChoice)) return null;

  const provider = getProviderDefinition(providerChoice as ProviderType);

  // Mostrar información del provider
  showProviderInfo(provider);

  // Pedir API key
  const apiKey = await requestApiKey(provider);
  if (!apiKey) return null;

  // Permitir custom base URL para providers OpenAI-compatible
  let baseUrl = provider.baseUrl;
  if (provider.openaiCompatible) {
    const customUrl = await p.confirm({
      message: `Use custom API URL? (default: ${provider.baseUrl})`,
      initialValue: false,
    });

    if (!p.isCancel(customUrl) && customUrl) {
      const url = await p.text({
        message: 'Enter API URL:',
        placeholder: provider.baseUrl,
        validate: (v) => {
          if (!v) return 'URL is required';
          if (!v.startsWith('http')) return 'Must start with http:// or https://';
          return;
        },
      });

      if (!p.isCancel(url) && url) {
        baseUrl = url;
      }
    }
  }

  // Seleccionar modelo
  const model = await selectModel(provider);
  if (!model) return null;

  // Testear conexión
  const valid = await testConnection(provider, apiKey, model, baseUrl);
  if (!valid) {
    const retry = await p.confirm({
      message: 'Would you like to try again?',
      initialValue: true,
    });

    if (retry && !p.isCancel(retry)) {
      return setupNewProvider();
    }
    return null;
  }

  return {
    type: provider.id,
    model,
    apiKey,
    baseUrl,
  };
}

/**
 * Mostrar información del provider
 */
function showProviderInfo(provider: ProviderDefinition): void {
  p.log.message('');
  p.log.step(`Setting up ${provider.emoji} ${provider.name}`);

  p.log.message(chalk.dim(`\n📖 Documentation: ${provider.docsUrl}`));
  p.log.message(chalk.dim(`🔑 Get API key: ${provider.apiKeyUrl}`));

  if (provider.features) {
    const features = [];
    if (provider.features.streaming) features.push('streaming');
    if (provider.features.functionCalling) features.push('tools');
    if (provider.features.vision) features.push('vision');
    p.log.message(chalk.dim(`✨ Features: ${features.join(', ')}`));
  }

  p.log.message('');
}

/**
 * Solicitar API key
 */
async function requestApiKey(provider: ProviderDefinition): Promise<string | null> {
  const apiKey = await p.password({
    message: `Enter your ${provider.name} API key:`,
    validate: (value) => {
      if (!value || value.length < 10) {
        return 'Please enter a valid API key (min 10 chars)';
      }
      return;
    },
  });

  if (p.isCancel(apiKey)) return null;
  return apiKey;
}

/**
 * Seleccionar modelo
 */
async function selectModel(provider: ProviderDefinition): Promise<string | null> {
  p.log.message('');
  p.log.step('Select a model');

  // Opciones de modelos
  const modelOptions = provider.models.map((m) => ({
    value: m.id,
    label: formatModelInfo(m),
  }));

  // Añadir opción de modelo personalizado
  if (provider.supportsCustomModels) {
    modelOptions.push({
      value: '__custom__',
      label: '✏️  Custom model (enter ID manually)',
    });
  }

  const choice = await p.select({
    message: 'Choose a model:',
    options: modelOptions,
  });

  if (p.isCancel(choice)) return null;

  // Manejar modelo personalizado
  if (choice === '__custom__') {
    const custom = await p.text({
      message: 'Enter model ID:',
      placeholder: provider.models[0]?.id || 'model-name',
      validate: (v) => (!v || !v.trim() ? 'Model ID is required' : undefined),
    });

    if (p.isCancel(custom)) return null;
    return custom;
  }

  return choice;
}

/**
 * Testear conexión con el provider
 */
async function testConnection(
  provider: ProviderDefinition,
  apiKey: string,
  model: string,
  baseUrl?: string
): Promise<boolean> {
  p.log.message('');
  const spinner = p.spinner();
  spinner.start(`Testing connection to ${provider.name}...`);

  // Debug info (solo en desarrollo)
  const debug = process.env.DEBUG === 'true';
  if (debug) {
    p.log.message(chalk.dim(`\n[Debug] Provider: ${provider.id}`));
    p.log.message(chalk.dim(`[Debug] Model: ${model}`));
    p.log.message(chalk.dim(`[Debug] Base URL: ${baseUrl || provider.baseUrl}`));
    p.log.message(chalk.dim(`[Debug] API Key: ${apiKey.substring(0, 10)}...`));
  }

  try {
    // Set env var temporalmente
    process.env[provider.envVar] = apiKey;
    if (baseUrl) {
      process.env[`${provider.id.toUpperCase()}_BASE_URL`] = baseUrl;
    }

    const testProvider = await createProvider(provider.id, { model });
    
    if (debug) {
      p.log.message(chalk.dim(`[Debug] Provider created: ${testProvider.id}`));
    }
    
    const available = await testProvider.isAvailable();

    if (!available) {
      spinner.stop('Connection failed');
      p.log.error(chalk.red(`\n❌ Could not connect to ${provider.name}`));
      p.log.message(chalk.dim('\nPossible causes:'));
      p.log.message(chalk.dim('  • Invalid API key'));
      p.log.message(chalk.dim('  • Invalid model name'));
      p.log.message(chalk.dim('  • Network connectivity issues'));
      p.log.message(chalk.dim('  • Provider service unavailable'));
      
      // Para Kimi, mostrar información específica
      if (provider.id === 'kimi') {
        p.log.message(chalk.dim('\n🌙 Kimi/Moonshot specific:'));
        p.log.message(chalk.dim('  • Get your key from: https://platform.moonshot.cn/console/api-keys'));
        p.log.message(chalk.dim('  • Ensure your account has credits'));
        p.log.message(chalk.dim('  • Try model: moonshot-v1-8k (most compatible)'));
      }
      
      return false;
    }

    spinner.stop(chalk.green('✅ Connected successfully!'));
    return true;
  } catch (error) {
    spinner.stop('Connection failed');
    const errorMsg = error instanceof Error ? error.message : String(error);
    p.log.error(chalk.red(`\n❌ Error: ${errorMsg}`));
    
    if (debug) {
      if (error instanceof Error && error.stack) {
        p.log.message(chalk.dim(`\n[Debug] Stack: ${error.stack}`));
      }
    }
    
    return false;
  }
}

/**
 * Guardar configuración
 */
export async function saveConfiguration(
  result: OnboardingResult
): Promise<void> {
  const provider = getProviderDefinition(result.type);

  const saveOptions = await p.select({
    message: 'How would you like to save this configuration?',
    options: [
      {
        value: 'env',
        label: '📝 Save to .env file',
        hint: 'Current directory only',
      },
      {
        value: 'global',
        label: '🔧 Save to shell profile',
        hint: 'Available in all terminals',
      },
      {
        value: 'session',
        label: '💨 This session only',
        hint: 'Will be lost when you exit',
      },
    ],
  });

  if (p.isCancel(saveOptions)) return;

  switch (saveOptions) {
    case 'env':
      await saveToEnvFile(provider.envVar, result.apiKey, result.baseUrl);
      break;
    case 'global':
      await saveToShellProfile(provider.envVar, result.apiKey, result.baseUrl);
      break;
    case 'session':
      // Ya está en process.env
      p.log.message(chalk.dim('\n💨 Configuration will be lost when you exit.'));
      break;
  }
}

/**
 * Guardar en archivo .env
 */
async function saveToEnvFile(
  envVar: string,
  apiKey: string,
  baseUrl?: string
): Promise<void> {
  const envPath = path.join(process.cwd(), '.env');

  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf-8');
  } catch {
    // Archivo no existe
  }

  const lines = content.split('\n');

  // Actualizar o añadir variables
  const updateVar = (name: string, value?: string) => {
    if (!value) return;
    const idx = lines.findIndex((l) => l.startsWith(`${name}=`));
    const line = `${name}=${value}`;
    if (idx >= 0) {
      lines[idx] = line;
    } else {
      lines.push(line);
    }
  };

  updateVar(envVar, apiKey);
  if (baseUrl) {
    updateVar(`${envVar.replace('_API_KEY', '_BASE_URL')}`, baseUrl);
  }

  await fs.writeFile(envPath, lines.join('\n').trim() + '\n', 'utf-8');
  p.log.success(`\n✅ Saved to ${envPath}`);
}

/**
 * Guardar en perfil de shell
 */
async function saveToShellProfile(
  envVar: string,
  apiKey: string,
  baseUrl?: string
): Promise<void> {
  const shell = process.env.SHELL || '';
  const home = process.env.HOME || '~';

  let profilePath: string;
  if (shell.includes('zsh')) {
    profilePath = path.join(home, '.zshrc');
  } else if (shell.includes('bash')) {
    profilePath = path.join(home, '.bashrc');
  } else {
    profilePath = path.join(home, '.profile');
  }

  let content = '';
  try {
    content = await fs.readFile(profilePath, 'utf-8');
  } catch {
    // Archivo no existe
  }

  const lines = content.split('\n');

  const addVar = (name: string, value?: string) => {
    if (!value) return;
    const exportLine = `export ${name}="${value}"`;
    const idx = lines.findIndex((l) => l.includes(`${name}=`));
    if (idx >= 0) {
      lines[idx] = exportLine;
    } else {
      lines.push(`# Corbat-Coco ${name}`, exportLine, '');
    }
  };

  addVar(envVar, apiKey);
  if (baseUrl) {
    addVar(`${envVar.replace('_API_KEY', '_BASE_URL')}`, baseUrl);
  }

  await fs.writeFile(profilePath, lines.join('\n').trim() + '\n', 'utf-8');
  p.log.success(`\n✅ Saved to ${profilePath}`);
  p.log.message(chalk.dim(`Run: source ${profilePath}`));
}

/**
 * Asegurar configuración antes de iniciar REPL
 */
export async function ensureConfiguredV2(
  config: ReplConfig
): Promise<ReplConfig | null> {
  // Verificar si ya tenemos provider configurado
  const providers = getAllProviders();
  const configured = providers.find(
    (p) => process.env[p.envVar] && p.id === config.provider.type
  );

  if (configured) {
    // Testear conexión
    try {
      const provider = await createProvider(configured.id, {
        model: config.provider.model,
      });
      if (await provider.isAvailable()) {
        return config;
      }
    } catch {
      // Falló, continuar con onboarding
    }
  }

  // Verificar si hay algún provider configurado
  const anyConfigured = providers.find((p) => process.env[p.envVar]);
  if (anyConfigured) {
    p.log.warning(`Provider ${config.provider.type} not available.`);
    p.log.info(`Found: ${anyConfigured.emoji} ${anyConfigured.name}`);

    const useAvailable = await p.confirm({
      message: `Use ${anyConfigured.name} instead?`,
      initialValue: true,
    });

    if (!p.isCancel(useAvailable) && useAvailable) {
      const recommended = getRecommendedModel(anyConfigured.id);
      return {
        ...config,
        provider: {
          ...config.provider,
          type: anyConfigured.id,
          model: recommended?.id || anyConfigured.models[0]?.id || '',
        },
      };
    }
  }

  // Ejecutar onboarding
  const result = await runOnboardingV2();
  if (!result) return null;

  // Guardar configuración
  await saveConfiguration(result);

  return {
    ...config,
    provider: {
      ...config.provider,
      type: result.type,
      model: result.model,
    },
  };
}
