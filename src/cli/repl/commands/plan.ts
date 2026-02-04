/**
 * Plan Command for REPL
 *
 * Runs the Orchestrate phase to design architecture.
 */

import * as p from '@clack/prompts';
import { runOrchestratePhase } from '../../../phases/orchestrate/executor.js';
import type { SlashCommand, ReplSession } from '../types.js';
import { getStateManager } from '../state/index.js';
import { createProvider } from '../../../providers/index.js';

/**
 * Plan command
 */
export const planCommand: SlashCommand = {
  name: 'plan',
  aliases: ['p'],
  description: 'Run the Orchestrate phase (architecture & planning)',
  usage: '/plan [--dry-run]',
  execute: async (args: string[], session: ReplSession): Promise<boolean> => {
    const dryRun = args.includes('--dry-run');

    p.intro('Plan Architecture');

    // Check trust level
    const { createTrustStore } = await import('../trust-store.js');
    const trustStore = createTrustStore();
    await trustStore.init();

    if (!trustStore.can(session.projectPath, 'write')) {
      p.log.error('Write access required to create plan');
      p.log.info('Run: /trust level write');
      return false;
    }

    // Confirm
    if (!dryRun) {
      const confirm = await p.confirm({
        message: 'Generate architecture and backlog?',
        initialValue: true,
      });

      if (p.isCancel(confirm) || !confirm) {
        p.outro('Cancelled');
        return false;
      }
    }

    // Run orchestrate phase
    const spinner = p.spinner();
    spinner.start('Designing architecture...');

    try {
      const provider = await createProvider(session.config.provider.type, {
        model: session.config.provider.model || undefined,
        maxTokens: session.config.provider.maxTokens,
      });

      await provider.initialize({
        model: session.config.provider.model || undefined,
        maxTokens: session.config.provider.maxTokens,
      });

      const result = await runOrchestratePhase(session.projectPath, provider);

      // Check if result is an error
      if ('error' in result) {
        spinner.stop('Planning failed');
        p.log.error(result.error);
        return false;
      }

      // Success - result is OrchestrateOutput
      spinner.stop('Architecture designed successfully');
      
      // Update project state
      const stateManager = getStateManager();
      await stateManager.completePhase(session.projectPath, 'orchestrate');
      
      p.log.message('');
      
      p.log.success('Generated:');
      p.log.info(`  ✓ Architecture: ${result.architecture.overview.description.split('.')[0] || 'Generated Architecture'}`);
      p.log.info(`  ✓ ADRs: ${result.adrs.length} decisions`);
      p.log.info(`  ✓ Backlog: ${result.backlog.backlog.epics.length} epics, ${result.backlog.backlog.stories.length} stories, ${result.backlog.backlog.tasks.length} tasks`);
      p.log.info(`  ✓ Sprint: ${result.firstSprint.name}`);

      p.log.message('');
      p.log.success('Next steps:');
      p.log.info('  /task list - View tasks');
      p.log.info('  /build - Start implementation');
    } catch (error) {
      spinner.stop('Failed to create plan');
      const message = error instanceof Error ? error.message : 'Unknown error';
      p.log.error(message);
    }

    p.outro('Done');
    return false;
  },
};
