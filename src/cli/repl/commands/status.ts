/**
 * Status Command for REPL
 *
 * Shows project and git status with COCO phase information.
 */

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import type { SlashCommand, ReplSession } from '../types.js';
import { getStateManager, formatStateStatus, getStateSummary } from '../state/index.js';
import { createTrustStore } from '../trust-store.js';

/**
 * Get git status
 */
function getGitStatus(projectPath: string): {
  isRepo: boolean;
  branch: string;
  modified: number;
  staged: number;
  untracked: number;
  ahead: number;
  behind: number;
} {
  try {
    // Check if git repo
    execSync('git rev-parse --git-dir', { cwd: projectPath, stdio: 'pipe' });
    
    const branch = execSync('git branch --show-current', { 
      cwd: projectPath, 
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim();
    
    const status = execSync('git status --porcelain', { 
      cwd: projectPath, 
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    
    const lines = status.split('\n').filter(Boolean);
    
    let modified = 0;
    let staged = 0;
    let untracked = 0;
    
    for (const line of lines) {
      const stagedFlag = line[0];
      const unstagedFlag = line[1];
      
      if (stagedFlag !== ' ' && stagedFlag !== '?') {
        staged++;
      }
      if (unstagedFlag === 'M' || unstagedFlag === 'D') {
        modified++;
      }
      if (stagedFlag === '?') {
        untracked++;
      }
    }
    
    // Get ahead/behind
    let ahead = 0;
    let behind = 0;
    try {
      const upstream = execSync('git rev-list --left-right --count HEAD...@{upstream}', {
        cwd: projectPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
      const [a, b] = upstream.split('\t').map(Number);
      ahead = a || 0;
      behind = b || 0;
    } catch {
      // No upstream
    }
    
    return {
      isRepo: true,
      branch,
      modified,
      staged,
      untracked,
      ahead,
      behind,
    };
  } catch {
    return {
      isRepo: false,
      branch: '',
      modified: 0,
      staged: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
    };
  }
}

/**
 * Status command
 */
export const statusCommand: SlashCommand = {
  name: 'status',
  aliases: ['s', 'st'],
  description: 'Show project and git status',
  usage: '/status',
  execute: async (_args: string[], session: ReplSession): Promise<boolean> => {
    p.intro('Project Status');
    
    const stateManager = getStateManager();
    const trustStore = createTrustStore();
    await trustStore.init();
    
    // Load project state
    const state = await stateManager.load(session.projectPath);
    const summary = getStateSummary(state);
    
    // COCO Status
    p.log.message('');
    p.log.step('COCO Phase');
    p.log.message(`  ${formatStateStatus(state)}`);
    
    // Phase indicators
    p.log.message('');
    p.log.message(chalk.dim('  Progress:'));
    p.log.message(`    ${summary.spec ? '✅' : '⬜'} Specification`);
    p.log.message(`    ${summary.architecture ? '✅' : '⬜'} Architecture`);
    p.log.message(`    ${summary.implementation ? '✅' : '⬜'} Implementation`);
    
    // Suggestion
    const suggestion = await stateManager.getSuggestion(session.projectPath);
    p.log.message('');
    p.log.info(`💡 ${suggestion}`);
    
    // Trust status
    p.log.message('');
    p.log.step('Trust');
    const trustLevel = trustStore.getLevel(session.projectPath);
    if (trustLevel) {
      const emoji = trustLevel === 'full' ? '🔓' : trustLevel === 'write' ? '✏️' : '👁️';
      p.log.message(`  ${emoji} ${trustLevel} access`);
    } else {
      p.log.message(`  ⚠️  Not trusted`);
    }
    
    // Git status
    p.log.message('');
    p.log.step('Git');
    const git = getGitStatus(session.projectPath);
    
    if (!git.isRepo) {
      p.log.message('  ❌ Not a git repository');
    } else {
      p.log.message(`  🌿 ${git.branch}`);
      
      if (git.ahead > 0 || git.behind > 0) {
        p.log.message(`  ↕️  ${git.ahead} ahead, ${git.behind} behind`);
      }
      
      if (git.staged > 0 || git.modified > 0 || git.untracked > 0) {
        p.log.message('');
        if (git.staged > 0) {
          p.log.message(`  📦 ${git.staged} staged`);
        }
        if (git.modified > 0) {
          p.log.message(`  📝 ${git.modified} modified`);
        }
        if (git.untracked > 0) {
          p.log.message(`  ❓ ${git.untracked} untracked`);
        }
      } else {
        p.log.message('  ✨ Working directory clean');
      }
    }
    
    // Session info
    p.log.message('');
    p.log.step('Session');
    p.log.message(`  📁 ${session.projectPath}`);
    p.log.message(`  🤖 ${session.config.provider.type} / ${session.config.provider.model}`);
    
    p.outro('Done');
    return false;
  },
};
