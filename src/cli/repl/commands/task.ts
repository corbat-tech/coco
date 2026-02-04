/**
 * Task Command for REPL
 *
 * Manage individual tasks in the backlog.
 */

import * as p from '@clack/prompts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SlashCommand, ReplSession } from '../types.js';
import type { Task, Sprint, Story, Backlog } from '../../../types/task.js';

/**
 * Load backlog from file
 */
async function loadBacklog(projectPath: string): Promise<Backlog | null> {
  try {
    const backlogPath = path.join(projectPath, '.coco', 'planning', 'backlog.json');
    const content = await fs.readFile(backlogPath, 'utf-8');
    const data = JSON.parse(content) as { backlog: Backlog };
    return data.backlog;
  } catch {
    return null;
  }
}

/**
 * Load sprint from file
 */
async function loadSprint(projectPath: string, sprintId?: string): Promise<Sprint | null> {
  try {
    const sprintsDir = path.join(projectPath, '.coco', 'planning', 'sprints');
    const files = await fs.readdir(sprintsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    if (jsonFiles.length === 0) return null;

    const targetFile = sprintId
      ? jsonFiles.find((f) => f.includes(sprintId))
      : jsonFiles[0];

    if (!targetFile) return null;

    const sprintPath = path.join(sprintsDir, targetFile);
    const content = await fs.readFile(sprintPath, 'utf-8');
    return JSON.parse(content) as Sprint;
  } catch {
    return null;
  }
}

/**
 * Save backlog to file
 */
async function saveBacklog(projectPath: string, backlog: Backlog): Promise<void> {
  const backlogPath = path.join(projectPath, '.coco', 'planning', 'backlog.json');
  const content = await fs.readFile(backlogPath, 'utf-8');
  const data = JSON.parse(content) as { backlog: Backlog };
  data.backlog = backlog;
  await fs.writeFile(backlogPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get status emoji for a task
 */
function getStatusEmoji(status: Task['status']): string {
  const emojis: Record<Task['status'], string> = {
    pending: '⬜',
    'in_progress': '🔄',
    completed: '✅',
    blocked: '🚫',
    rolled_back: '⏪',
  };
  return emojis[status] || '⬜';
}

/**
 * Get complexity label
 */
function getComplexityLabel(complexity: Task['estimatedComplexity']): string {
  const labels: Record<Task['estimatedComplexity'], string> = {
    trivial: '<30m',
    simple: '30m-2h',
    moderate: '2-8h',
    complex: '>8h',
  };
  return labels[complexity] || '';
}

/**
 * Task command
 */
export const taskCommand: SlashCommand = {
  name: 'task',
  aliases: ['t'],
  description: 'Manage individual tasks',
  usage: '/task [list|show <id>|start <id>|done <id>]',
  execute: async (args: string[], session: ReplSession): Promise<boolean> => {
    const subcommand = args[0] || 'list';
    const taskId = args[1];

    // Load backlog and sprint
    const backlog = await loadBacklog(session.projectPath);
    const sprint = await loadSprint(session.projectPath);

    if (!backlog) {
      p.log.error('No backlog found. Run /plan first.');
      return false;
    }

    switch (subcommand) {
      case 'list': {
        p.intro('Task List');

        // Get sprint tasks or all tasks
        const tasks: Task[] = sprint
          ? backlog.tasks.filter((t: Task) =>
              sprint.stories.some((sid: string) => sid === t.storyId)
            )
          : backlog.tasks;

        if (tasks.length === 0) {
          p.log.message('No tasks found.');
          break;
        }

        // Group by status
        const byStatus = tasks.reduce<Record<string, Task[]>>(
          (acc, t) => {
            const status = t.status;
            if (!acc[status]) acc[status] = [];
            acc[status].push(t);
            return acc;
          },
          {}
        );

        p.log.message('');
        p.log.step(`Found ${tasks.length} tasks${sprint ? ` in sprint "${sprint.name}"` : ''}`);
        p.log.message('');

        const statuses: Task['status'][] = ['pending', 'in_progress', 'completed', 'blocked', 'rolled_back'];
        for (const status of statuses) {
          const group = byStatus[status];
          if (group && group.length > 0) {
            p.log.message(`${getStatusEmoji(status)} **${status.replace('_', ' ')}** (${group.length})`);
            for (const task of group) {
              const story = backlog.stories.find((s: Story) => s.id === task.storyId);
              p.log.message(`   ${task.id}: ${task.title}${story ? ` (${story.title})` : ''} [${getComplexityLabel(task.estimatedComplexity)}]`);
            }
            p.log.message('');
          }
        }
        break;
      }

      case 'show': {
        if (!taskId) {
          p.log.error('Usage: /task show <task-id>');
          return false;
        }

        const task = backlog.tasks.find((t: Task) => t.id === taskId);
        if (!task) {
          p.log.error(`Task not found: ${taskId}`);
          return false;
        }

        const story = backlog.stories.find((s: Story) => s.id === task.storyId);

        p.intro(`Task: ${task.title}`);
        p.log.message('');
        p.log.message(`ID: ${task.id}`);
        p.log.message(`Story: ${story?.title || 'Unknown'}`);
        p.log.message(`Status: ${getStatusEmoji(task.status)} ${task.status}`);
        p.log.message(`Type: ${task.type}`);
        p.log.message(`Complexity: ${task.estimatedComplexity} (${getComplexityLabel(task.estimatedComplexity)})`);
        if (task.description) {
          p.log.message('');
          p.log.message('Description:');
          p.log.message(`  ${task.description}`);
        }
        if (task.files?.length) {
          p.log.message('');
          p.log.message('Files:');
          for (const file of task.files) {
            p.log.message(`  • ${file}`);
          }
        }
        if (task.dependencies?.length) {
          p.log.message('');
          p.log.message('Dependencies:');
          for (const dep of task.dependencies) {
            const depTask = backlog.tasks.find((t: Task) => t.id === dep);
            p.log.message(`  • ${dep}${depTask ? ` (${depTask.title})` : ''}`);
          }
        }
        break;
      }

      case 'start': {
        if (!taskId) {
          p.log.error('Usage: /task start <task-id>');
          return false;
        }

        // Check trust for write
        const { createTrustStore } = await import('../trust-store.js');
        const trustStore = createTrustStore();
        await trustStore.init();

        if (!trustStore.can(session.projectPath, 'write')) {
          p.log.error('Write access required to update tasks');
          p.log.info('Run: /trust level write');
          return false;
        }

        const task = backlog.tasks.find((t: Task) => t.id === taskId);
        if (!task) {
          p.log.error(`Task not found: ${taskId}`);
          return false;
        }

        task.status = 'in_progress';
        await saveBacklog(session.projectPath, backlog);

        p.log.success(`Started task: ${taskId}`);
        p.log.info('Run /build to execute with quality iteration');
        break;
      }

      case 'done': {
        if (!taskId) {
          p.log.error('Usage: /task done <task-id>');
          return false;
        }

        // Check trust for write
        const { createTrustStore } = await import('../trust-store.js');
        const trustStore = createTrustStore();
        await trustStore.init();

        if (!trustStore.can(session.projectPath, 'write')) {
          p.log.error('Write access required to update tasks');
          p.log.info('Run: /trust level write');
          return false;
        }

        const task = backlog.tasks.find((t: Task) => t.id === taskId);
        if (!task) {
          p.log.error(`Task not found: ${taskId}`);
          return false;
        }

        task.status = 'completed';
        await saveBacklog(session.projectPath, backlog);

        p.log.success(`Marked task as completed: ${taskId}`);
        break;
      }

      default: {
        p.log.error(`Unknown subcommand: ${subcommand}`);
        p.log.info('Available: list, show, start, done');
        return false;
      }
    }

    return false;
  },
};
