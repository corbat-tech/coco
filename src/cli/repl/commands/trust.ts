/**
 * Trust Command for REPL
 *
 * Manages project trust permissions.
 */

import * as p from '@clack/prompts';
import type { SlashCommand, ReplSession } from '../types.js';
import {
  createTrustStore,
  type TrustLevel,
} from '../trust-store.js';

/**
 * Trust command
 */
export const trustCommand: SlashCommand = {
  name: 'trust',
  aliases: [],
  description: 'Manage project trust permissions',
  usage: '/trust [status|level <level>|revoke|list]',
  execute: async (args: string[], session: ReplSession): Promise<boolean> => {
    const subcommand = args[0] ?? 'status';
    const trustStore = createTrustStore();
    await trustStore.init();

    try {
      switch (subcommand) {
        case 'status':
          await showTrustStatus(session, trustStore);
          return false;
        case 'level':
          await changeTrustLevel(args[1], session, trustStore);
          return false;
        case 'revoke':
          await revokeTrust(session, trustStore);
          return false;
        case 'list':
          await listTrustedProjects(trustStore);
          return false;
        default:
          p.log.error(`Unknown subcommand: ${subcommand}`);
          p.log.info('Usage: /trust [status|level <read|write|full>|revoke|list]');
          return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      p.log.error(message);
      return false;
    }
  },
};

/**
 * Show current trust status
 */
async function showTrustStatus(
  session: ReplSession,
  trustStore: ReturnType<typeof createTrustStore>
): Promise<void> {
  const projectPath = session.projectPath;
  const isTrusted = trustStore.isTrusted(projectPath);

  if (!isTrusted) {
    p.log.message('');
    p.log.message('🔒 Project not trusted');
    p.log.message(`   Path: ${projectPath}`);
    p.log.message('');
    p.log.info('Run the REPL again to approve access, or use:');
    p.log.info('  /trust level <read|write|full>');
    return;
  }

  const level = trustStore.getLevel(projectPath);
  const list = trustStore.list();
  const project = list.find((p) => p.path === projectPath);

  p.log.message('');
  p.log.message(`🔐 Project Trust Status`);
  p.log.message(`   Path: ${projectPath}`);
  p.log.message(`   Level: ${level}`);
  
  if (project) {
    p.log.message(`   Approved: ${new Date(project.approvedAt).toLocaleString()}`);
    p.log.message(`   Last accessed: ${new Date(project.lastAccessed).toLocaleString()}`);
    if (project.toolsTrusted.length > 0) {
      p.log.message(`   Trusted tools: ${project.toolsTrusted.join(', ')}`);
    }
  }
  
  p.log.message('');
  p.log.info('Permissions:');
  p.log.info(`  Read files: ${trustStore.can(projectPath, 'read') ? '✓' : '✗'}`);
  p.log.info(`  Write files: ${trustStore.can(projectPath, 'write') ? '✓' : '✗'}`);
  p.log.info(`  Execute commands: ${trustStore.can(projectPath, 'execute') ? '✓' : '✗'}`);
  p.log.message('');
}

/**
 * Change trust level
 */
async function changeTrustLevel(
  level: string | undefined,
  session: ReplSession,
  trustStore: ReturnType<typeof createTrustStore>
): Promise<void> {
  const projectPath = session.projectPath;

  // If no level provided, prompt user
  if (!level) {
    const selected = await p.select({
      message: 'Select trust level',
      options: [
        { value: 'read', label: 'Read-only (view files only)' },
        { value: 'write', label: 'Write (read + modify files)' },
        { value: 'full', label: 'Full (all operations including bash)' },
      ],
    });

    if (p.isCancel(selected)) {
      p.outro('Cancelled');
      return;
    }

    level = selected as string;
  }

  // Validate level
  const validLevels: TrustLevel[] = ['read', 'write', 'full'];
  if (!validLevels.includes(level as TrustLevel)) {
    p.log.error(`Invalid level: ${level}`);
    p.log.info('Valid levels: read, write, full');
    return;
  }

  const spinner = p.spinner();
  spinner.start('Updating trust level...');

  try {
    await trustStore.addTrust(projectPath, level as TrustLevel);
    spinner.stop(`Trust level updated to: ${level}`);
  } catch (error) {
    spinner.stop('Failed to update trust level');
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(message);
  }
}

/**
 * Revoke trust for current project
 */
async function revokeTrust(
  session: ReplSession,
  trustStore: ReturnType<typeof createTrustStore>
): Promise<void> {
  const projectPath = session.projectPath;

  // Confirm if trusted
  if (!trustStore.isTrusted(projectPath)) {
    p.log.info('This project is not currently trusted');
    return;
  }

  // Confirm revocation
  const confirm = await p.confirm({
    message: 'Revoke all access to this project?',
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro('Cancelled');
    return;
  }

  const spinner = p.spinner();
  spinner.start('Revoking trust...');

  try {
    const removed = await trustStore.removeTrust(projectPath);
    if (removed) {
      spinner.stop('Trust revoked. Access to this project has been removed.');
    } else {
      spinner.stop('Nothing to revoke');
    }
  } catch (error) {
    spinner.stop('Failed to revoke trust');
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(message);
  }
}

/**
 * List all trusted projects
 */
async function listTrustedProjects(
  trustStore: ReturnType<typeof createTrustStore>
): Promise<void> {
  const projects = trustStore.list();

  if (projects.length === 0) {
    p.outro('No trusted projects');
    return;
  }

  p.log.message('');
  p.log.message('📋 Trusted Projects:');
  p.log.message('');

  for (const project of projects) {
    const level = project.approvalLevel.toUpperCase().padEnd(5);
    const path = project.path.length > 50 
      ? '...' + project.path.slice(-47) 
      : project.path;
    
    p.log.message(`  [${level}] ${path}`);
    p.log.message(`      Last accessed: ${new Date(project.lastAccessed).toLocaleString()}`);
  }

  p.log.message('');
  p.outro(`Total: ${projects.length} project${projects.length === 1 ? '' : 's'}`);
}
