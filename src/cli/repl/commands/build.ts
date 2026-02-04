/**
 * Build Command for REPL
 *
 * Placeholder for Complete phase execution.
 */

import * as p from '@clack/prompts';
import type { SlashCommand, ReplSession } from '../types.js';

/**
 * Build command
 */
export const buildCommand: SlashCommand = {
  name: 'build',
  aliases: ['b'],
  description: 'Run the Complete phase (build with quality)',
  usage: '/build [--sprint=N] [--task=N]',
  execute: async (_args: string[], session: ReplSession): Promise<boolean> => {
    p.intro('Build Project');

    // Check trust level
    const { createTrustStore } = await import('../trust-store.js');
    const trustStore = createTrustStore();
    await trustStore.init();

    if (!trustStore.can(session.projectPath, 'write')) {
      p.log.error('Write access required to build project');
      p.log.info('Run: /trust level write');
      return false;
    }

    p.log.message('');
    p.log.info('The build command will execute the Complete phase:');
    p.log.info('  - Read backlog from .coco/ directory');
    p.log.info('  - Implement tasks with quality convergence');
    p.log.info('  - Run tests and iterate until score >= 85');
    p.log.message('');
    p.log.warning('This feature is coming in the next update.');
    p.log.message('');
    p.log.info('For now, use the CLI command:');
    p.log.info('  coco build');

    p.outro('Done');
    return false;
  },
};
