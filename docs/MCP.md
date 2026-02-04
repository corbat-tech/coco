# MCP (Model Context Protocol) Support

Corbat-Coco supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/), enabling integration with 100+ external tools and services.

## Overview

The MCP module provides:

- **MCP Client**: Connect to MCP servers via stdio or HTTP
- **Registry**: Manage multiple MCP server configurations
- **Tools Wrapper**: Use MCP tools as native COCO tools
- **CLI Commands**: Manage servers via `coco mcp` commands

## Quick Start

### 1. Add an MCP Server

```bash
# Add a stdio-based server
coco mcp add filesystem \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-filesystem,/home/user" \
  --description "Filesystem access"

# Add an HTTP-based server with authentication
coco mcp add remote-api \
  --transport http \
  --url "https://api.example.com/mcp" \
  --description "Remote API"
```

### 2. List Servers

```bash
# List enabled servers
coco mcp list

# List all servers including disabled
coco mcp list --all
```

### 3. Use MCP Tools in Code

```typescript
import { createMCPClient, StdioTransport, registerMCPTools } from 'corbat-coco/mcp';
import { createFullToolRegistry } from 'corbat-coco/tools';

// Create client
const transport = new StdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user'],
});

const client = createMCPClient(transport);

// Register MCP tools in COCO registry
const registry = createFullToolRegistry();
const wrappedTools = await registerMCPTools(registry, 'filesystem', client);

// Now use the tools
const result = await registry.execute('mcp_filesystem_read_file', {
  path: '/home/user/document.txt',
});

console.log(result.data); // File content
```

## Configuration

### Config File Format

Create an `mcp.json` file:

```json
{
  "version": "1.0",
  "servers": [
    {
      "name": "filesystem",
      "description": "Filesystem access",
      "transport": "stdio",
      "stdio": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"]
      }
    },
    {
      "name": "remote-api",
      "description": "Remote API",
      "transport": "http",
      "http": {
        "url": "https://api.example.com/mcp",
        "auth": {
          "type": "bearer",
          "tokenEnv": "API_TOKEN"
        }
      }
    }
  ]
}
```

Load it programmatically:

```typescript
import { loadMCPConfigFile, createMCPRegistry } from 'corbat-coco/mcp';

const servers = await loadMCPConfigFile('./mcp.json');
const registry = createMCPRegistry();

for (const server of servers) {
  await registry.addServer(server);
}
```

### COCO Config Integration

Add MCP servers to your `coco.config.json`:

```json
{
  "project": {
    "name": "my-project"
  },
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"]
      }
    ]
  }
}
```

## Transports

### Stdio Transport

For local command-based MCP servers:

```typescript
import { StdioTransport } from 'corbat-coco/mcp';

const transport = new StdioTransport({
  command: 'python',
  args: ['-m', 'mcp_server'],
  env: { API_KEY: 'secret' },
  cwd: '/path/to/workdir',
  timeout: 60000,
});
```

### HTTP Transport

For remote MCP servers with authentication:

```typescript
import { HTTPTransport } from 'corbat-coco/mcp';

// Bearer token
const transport = new HTTPTransport({
  url: 'https://api.example.com/mcp',
  auth: {
    type: 'bearer',
    token: 'your-token',
    // or tokenEnv: 'API_TOKEN'
  },
  timeout: 60000,
  retries: 3,
});

// API Key
const transport = new HTTPTransport({
  url: 'https://api.example.com/mcp',
  auth: {
    type: 'apikey',
    token: 'your-api-key',
    headerName: 'X-API-Key',
  },
});

// OAuth
const transport = new HTTPTransport({
  url: 'https://api.example.com/mcp',
  auth: {
    type: 'oauth',
    token: 'oauth-token',
  },
});
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `coco mcp add <name>` | Add a new MCP server |
| `coco mcp remove <name>` | Remove an MCP server |
| `coco mcp list` | List registered servers |
| `coco mcp enable <name>` | Enable a server |
| `coco mcp disable <name>` | Disable a server |

### Add Command Options

```bash
coco mcp add <name> \
  --transport <stdio|http> \
  --command <cmd> \
  --args <arg1,arg2,...> \
  --url <url> \
  --env <KEY=value,...> \
  --description <desc>
```

## Tool Naming

MCP tools are prefixed when registered in COCO:

- Format: `mcp_<server-name>_<tool-name>`
- Example: `mcp_filesystem_read_file`

## Error Handling

The MCP module provides specific error types:

```typescript
import { MCPError, MCPConnectionError, MCPTimeoutError } from 'corbat-coco/mcp';

try {
  await client.callTool({ name: 'read_file', arguments: { path: '/test' } });
} catch (error) {
  if (error instanceof MCPTimeoutError) {
    console.log('Request timed out');
  } else if (error instanceof MCPConnectionError) {
    console.log('Connection failed');
  }
}
```

## Advanced Usage

### Custom Tool Wrapper Options

```typescript
import { wrapMCPTools } from 'corbat-coco/mcp';

const { tools, wrapped } = wrapMCPTools(
  mcpTools,
  'my-server',
  client,
  {
    namePrefix: 'custom',     // Default: 'mcp'
    category: 'file',         // Default: 'deploy'
    requestTimeout: 30000,    // Default: 60000
  }
);
```

### Manual Registry Management

```typescript
import { createMCPRegistry } from 'corbat-coco/mcp';

const registry = createMCPRegistry();
await registry.load();

// Add server
await registry.addServer({
  name: 'custom-server',
  transport: 'stdio',
  stdio: { command: 'my-command' },
  enabled: true,
});

// Check if exists
if (registry.hasServer('custom-server')) {
  const config = registry.getServer('custom-server');
  console.log(config);
}

// List enabled servers
const enabled = registry.listEnabledServers();
```

## API Reference

### Types

- `MCPClient` - Client interface for MCP servers
- `MCPTransport` - Transport interface (stdio/http)
- `MCPServerConfig` - Server configuration
- `MCPTool` - MCP tool definition
- `MCPWrappedTool` - Wrapped tool information

### Functions

- `createMCPClient(transport, timeout?)` - Create MCP client
- `createMCPRegistry(path?)` - Create server registry
- `registerMCPTools(registry, serverName, client, options?)` - Register MCP tools
- `loadMCPConfigFile(path)` - Load config from JSON file
- `loadMCPServersFromCOCOConfig(path?)` - Load from COCO config

## Examples

### Filesystem Server

```bash
coco mcp add filesystem \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-filesystem,/home/user" \
  --description "Local filesystem access"
```

### GitHub Server

```bash
coco mcp add github \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-github" \
  --env "GITHUB_TOKEN=$GITHUB_TOKEN"
```

### PostgreSQL Server

```bash
coco mcp add postgres \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-postgres,postgresql://localhost/mydb"
```

## Troubleshooting

### Connection Issues

1. Verify the server command exists: `which <command>`
2. Check server logs for errors
3. Ensure required environment variables are set
4. Verify network connectivity for HTTP servers

### Tool Not Found

1. Check server is enabled: `coco mcp list --all`
2. Verify tool name with prefix: `mcp_<server>_<tool>`
3. Check server capabilities: `client.listTools()`

### Authentication Errors

1. For stdio: Check environment variables in `--env`
2. For HTTP: Verify token or use `tokenEnv` to load from env
3. Check token permissions with the server provider

## Resources

- [MCP Specification](https://modelcontextprotocol.io/)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [COCO Tools Documentation](./TOOLS.md)
