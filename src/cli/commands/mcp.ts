/**
 * MCP Command
 *
 * CLI commands for managing MCP servers.
 */

import { Command } from 'commander';
import * as p from '@clack/prompts';
import { createMCPRegistry } from '../../mcp/registry.js';
import { validateServerConfig } from '../../mcp/config.js';
import type { MCPServerConfig } from '../../mcp/types.js';

/**
 * Register MCP command
 */
export function registerMCPCommand(program: Command): void {
  const mcpCommand = program
    .command('mcp')
    .description('Manage MCP (Model Context Protocol) servers');

  // Add subcommand
  mcpCommand
    .command('add')
    .description('Add a new MCP server')
    .argument('<name>', 'Server name (unique identifier)')
    .option('-c, --command <cmd>', 'Command for stdio transport')
    .option('-a, --args <args>', 'Arguments for command (comma-separated)')
    .option('-u, --url <url>', 'URL for HTTP transport')
    .option('-t, --transport <type>', 'Transport type (stdio or http)', 'stdio')
    .option('-e, --env <env>', 'Environment variables (KEY=value,...)')
    .option('-d, --description <desc>', 'Server description')
    .action(runAddServer);

  // Remove subcommand
  mcpCommand
    .command('remove')
    .description('Remove an MCP server')
    .argument('<name>', 'Server name to remove')
    .option('-y, --yes', 'Skip confirmation')
    .action(runRemoveServer);

  // List subcommand
  mcpCommand
    .command('list')
    .description('List registered MCP servers')
    .option('-a, --all', 'Show all servers including disabled')
    .action(runListServers);

  // Enable/disable subcommands
  mcpCommand
    .command('enable')
    .description('Enable an MCP server')
    .argument('<name>', 'Server name to enable')
    .action(runEnableServer);

  mcpCommand
    .command('disable')
    .description('Disable an MCP server')
    .argument('<name>', 'Server name to disable')
    .action(runDisableServer);
}

/**
 * Run add server command
 */
async function runAddServer(
  name: string,
  options: {
    command?: string;
    args?: string;
    url?: string;
    transport: string;
    env?: string;
    description?: string;
  }
): Promise<void> {
  p.intro('Add MCP Server');

  const registry = createMCPRegistry();
  await registry.load();

  // Check if server already exists
  if (registry.hasServer(name)) {
    const overwrite = await p.confirm({
      message: `Server '${name}' already exists. Overwrite?`,
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.outro('Cancelled');
      return;
    }
  }

  // Validate transport
  const transport = options.transport as 'stdio' | 'http';
  if (transport !== 'stdio' && transport !== 'http') {
    p.log.error(`Invalid transport type: ${transport}. Must be 'stdio' or 'http'`);
    process.exit(1);
  }

  // Build config based on transport
  let config: MCPServerConfig;

  if (transport === 'stdio') {
    // Get command
    let command = options.command;
    if (!command) {
      const input = await p.text({
        message: 'Command to execute',
        placeholder: 'npx -y @modelcontextprotocol/server-filesystem',
        validate: (value) => {
          if (!value || value.length === 0) return 'Command is required';
          return;
        },
      });

      if (p.isCancel(input)) {
        p.outro('Cancelled');
        return;
      }
      command = input;
    }

    // Parse args
    const args = options.args ? options.args.split(',').map((a) => a.trim()) : [];

    // Parse env
    const env: Record<string, string> = {};
    if (options.env) {
      for (const pair of options.env.split(',')) {
        const [key, value] = pair.split('=');
        if (key && value) {
          env[key.trim()] = value.trim();
        }
      }
    }

    config = {
      name,
      description: options.description,
      transport: 'stdio',
      stdio: {
        command,
        args: args.length > 0 ? args : undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
      },
      enabled: true,
    };
  } else {
    // HTTP transport
    let url = options.url;
    if (!url) {
      const input = await p.text({
        message: 'Server URL',
        placeholder: 'https://api.example.com/mcp',
        validate: (value) => {
          if (!value || value.length === 0) return 'URL is required';
          try {
            new URL(value);
            return;
          } catch {
            return 'Invalid URL';
          }
        },
      });

      if (p.isCancel(input)) {
        p.outro('Cancelled');
        return;
      }
      url = input;
    }

    config = {
      name,
      description: options.description,
      transport: 'http',
      http: {
        url: url!,
      },
      enabled: true,
    };
  }

  // Validate config
  try {
    validateServerConfig(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid configuration';
    p.log.error(`Validation error: ${message}`);
    process.exit(1);
  }

  // Add server
  const spinner = p.spinner();
  spinner.start('Adding server...');

  try {
    await registry.addServer(config);
    spinner.stop(`Server '${name}' added successfully`);
  } catch (error) {
    spinner.stop('Failed to add server');
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(message);
    process.exit(1);
  }

  p.outro('Done');
}

/**
 * Run remove server command
 */
async function runRemoveServer(
  name: string,
  options: { yes?: boolean }
): Promise<void> {
  p.intro('Remove MCP Server');

  const registry = createMCPRegistry();
  await registry.load();

  if (!registry.hasServer(name)) {
    p.log.error(`Server '${name}' not found`);
    process.exit(1);
  }

  // Confirm removal
  if (!options.yes) {
    const confirm = await p.confirm({
      message: `Remove server '${name}'?`,
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.outro('Cancelled');
      return;
    }
  }

  const spinner = p.spinner();
  spinner.start('Removing server...');

  try {
    await registry.removeServer(name);
    spinner.stop(`Server '${name}' removed`);
  } catch (error) {
    spinner.stop('Failed to remove server');
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(message);
    process.exit(1);
  }

  p.outro('Done');
}

/**
 * Run list servers command
 */
async function runListServers(options: { all?: boolean }): Promise<void> {
  const registry = createMCPRegistry();
  await registry.load();

  const servers = options.all ? registry.listServers() : registry.listEnabledServers();

  if (servers.length === 0) {
    if (options.all) {
      p.outro('No MCP servers registered');
    } else {
      p.outro('No enabled MCP servers. Use --all to see disabled servers.');
    }
    return;
  }

  p.log.message('\nRegistered MCP Servers:');
  p.log.message('');

  for (const server of servers) {
    const status = server.enabled === false ? '🔴 disabled' : '🟢 enabled';
    const transport = server.transport === 'stdio' 
      ? `stdio: ${server.stdio?.command}` 
      : `http: ${server.http?.url}`;

    p.log.message(`  ${server.name}`);
    p.log.message(`    Status: ${status}`);
    p.log.message(`    Transport: ${transport}`);
    if (server.description) {
      p.log.message(`    Description: ${server.description}`);
    }
    p.log.message('');
  }

  p.outro(`Total: ${servers.length} server${servers.length === 1 ? '' : 's'}`);
}

/**
 * Run enable server command
 */
async function runEnableServer(name: string): Promise<void> {
  const registry = createMCPRegistry();
  await registry.load();

  const server = registry.getServer(name);
  if (!server) {
    p.log.error(`Server '${name}' not found`);
    process.exit(1);
  }

  if (server.enabled !== false) {
    p.outro(`Server '${name}' is already enabled`);
    return;
  }

  const spinner = p.spinner();
  spinner.start('Enabling server...');

  try {
    await registry.addServer({ ...server, enabled: true });
    spinner.stop(`Server '${name}' enabled`);
  } catch (error) {
    spinner.stop('Failed to enable server');
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(message);
    process.exit(1);
  }

  p.outro('Done');
}

/**
 * Run disable server command
 */
async function runDisableServer(name: string): Promise<void> {
  const registry = createMCPRegistry();
  await registry.load();

  const server = registry.getServer(name);
  if (!server) {
    p.log.error(`Server '${name}' not found`);
    process.exit(1);
  }

  if (server.enabled === false) {
    p.outro(`Server '${name}' is already disabled`);
    return;
  }

  const spinner = p.spinner();
  spinner.start('Disabling server...');

  try {
    await registry.addServer({ ...server, enabled: false });
    spinner.stop(`Server '${name}' disabled`);
  } catch (error) {
    spinner.stop('Failed to disable server');
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(message);
    process.exit(1);
  }

  p.outro('Done');
}
