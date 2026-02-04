/**
 * Init Command for REPL
 *
 * Runs the Converge phase to initialize a new project.
 */

import * as p from '@clack/prompts';
import { runConvergePhase } from '../../../phases/converge/executor.js';
import type { SlashCommand, ReplSession } from '../types.js';
import { getStateManager } from '../state/index.js';
import { createProvider } from '../../../providers/index.js';


/**
 * Init command
 */
export const initCommand: SlashCommand = {
  name: 'init',
  aliases: ['i'],
  description: 'Initialize a new project (Converge phase)',
  usage: '/init [name] [--yes]',
  execute: async (args: string[], session: ReplSession): Promise<boolean> => {
    const projectName = args[0];
    const yes = args.includes('--yes');

    p.intro('Initialize Project');

    // Check trust level
    const { createTrustStore } = await import('../trust-store.js');
    const trustStore = createTrustStore();
    await trustStore.init();

    if (!trustStore.can(session.projectPath, 'write')) {
      p.log.error('Write access required to initialize project');
      p.log.info('Run: /trust level write');
      return false;
    }

    // Get project name if not provided
    let name = projectName;
    if (!name && !yes) {
      const input = await p.text({
        message: 'Project name',
        placeholder: 'my-project',
        validate: (value) => {
          if (!value || value.length === 0) return 'Name is required';
          if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
            return 'Name must be alphanumeric with hyphens/underscores';
          }
          return;
        },
      });

      if (p.isCancel(input)) {
        p.outro('Cancelled');
        return false;
      }
      name = input;
    }

    if (!name) {
      // Use directory name as default
      name = session.projectPath.split('/').pop() || 'project';
    }

    // Get description
    let description = '';
    if (!yes) {
      const input = await p.text({
        message: 'What would you like to build?',
        placeholder: 'A REST API for task management',
      });

      if (p.isCancel(input)) {
        p.outro('Cancelled');
        return false;
      }
      description = input || '';
    }

    // Select language
    let language: string = 'typescript';
    if (!yes) {
      const selected = await p.select({
        message: 'Select language',
        options: [
          { value: 'typescript', label: 'TypeScript (Recommended)' },
          { value: 'python', label: 'Python' },
          { value: 'go', label: 'Go' },
          { value: 'rust', label: 'Rust' },
          { value: 'java', label: 'Java' },
        ],
      });

      if (p.isCancel(selected)) {
        p.outro('Cancelled');
        return false;
      }
      language = selected as string;
    }

    // Confirm
    if (!yes) {
      p.log.message('');
      p.log.message('Project configuration:');
      p.log.message(`  Name: ${name}`);
      p.log.message(`  Language: ${language}`);
      if (description) {
        p.log.message(`  Description: ${description}`);
      }
      p.log.message('');

      const confirm = await p.confirm({
        message: 'Create project?',
        initialValue: true,
      });

      if (p.isCancel(confirm) || !confirm) {
        p.outro('Cancelled');
        return false;
      }
    }

    // Run converge phase
    const spinner = p.spinner();
    spinner.start('Initializing project...');

    try {
      const provider = await createProvider(session.config.provider.type, {
        model: session.config.provider.model || undefined,
        maxTokens: session.config.provider.maxTokens,
      });

      await provider.initialize({
        model: session.config.provider.model || undefined,
        maxTokens: session.config.provider.maxTokens,
      });

      const result = await runConvergePhase(
        session.projectPath,
        provider,
        description
          ? {
              onUserInput: async () => description,
            }
          : undefined
      );

      if (result.success) {
        spinner.stop(`Project "${name}" initialized successfully`);
        
        // Update project state
        const stateManager = getStateManager();
        await stateManager.completePhase(session.projectPath, 'converge');
        
        p.log.message('');
        p.log.success('Next steps:');
        p.log.info('  /plan - Design architecture');
        p.log.info('  /build - Start implementation');
      } else {
        spinner.stop('Project initialization failed');
        if (result.error) {
          p.log.error(result.error);
        }
      }
    } catch (error) {
      spinner.stop('Failed to initialize project');
      const message = error instanceof Error ? error.message : 'Unknown error';
      p.log.error(message);
    }

    p.outro('Done');
    return false;
  },
};
