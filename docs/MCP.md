# MCP (Model Context Protocol) Guide

MCP lets Coco connect to external tools and services: GitHub, databases, web search, file systems, APIs, and more. Over 100 MCP servers are available in the [official registry](https://github.com/modelcontextprotocol/servers).

---

## First 5 minutes

### 1. Create `.mcp.json` in your project root

This is the standard cross-agent MCP config format, compatible with Claude Code, Cursor, and Windsurf.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

Coco reads `.mcp.json` automatically when you start a session. No extra configuration needed.

### 2. Set your environment variables

Never hardcode tokens in `.mcp.json`. Use environment variables instead:

```bash
# In your shell profile (.zshrc, .bashrc), or store it in ~/.coco/.env
export GITHUB_TOKEN="ghp_your_token_here"
```

### 3. Start Coco and verify

```bash
coco
```

Inside the REPL:

```
/mcp status
```

You should see your server listed as connected with its available tools.

---

## Configuration formats

### Standard format (recommended)

The `mcpServers` format is the cross-agent standard. Use this in `.mcp.json`:

```json
{
  "mcpServers": {
    "<server-name>": {
      "command": "...",
      "args": [...],
      "env": { "KEY": "value" }
    }
  }
}
```

Transport is auto-detected:
- `command` present → stdio (local process)
- `url` present → HTTP/SSE (remote server)

### Coco config integration

You can also declare servers inside `coco.config.json` for project-specific settings:

```json
{
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "my-db",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"]
      }
    ]
  }
}
```

---

## Authentication

### Environment variables (recommended)

Reference env vars in `env` (stdio) or `headers` (HTTP):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

Set them in your shell profile or in `~/.coco/.env` (Coco's global env file).

### Bearer token (HTTP servers)

```json
{
  "mcpServers": {
    "my-api": {
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MY_API_TOKEN}"
      }
    }
  }
}
```

### API key with custom header

```json
{
  "mcpServers": {
    "my-service": {
      "url": "https://service.example.com/mcp",
      "headers": {
        "X-API-Key": "${SERVICE_API_KEY}"
      }
    }
  }
}
```

### OAuth (via Coco extended format in `coco.config.json`)

```json
{
  "mcp": {
    "servers": [
      {
        "name": "oauth-service",
        "transport": "http",
        "url": "https://service.example.com/mcp",
        "auth": {
          "type": "oauth",
          "tokenEnv": "OAUTH_ACCESS_TOKEN"
        }
      }
    ]
  }
}
```

---

## Common servers

### GitHub

```json
"github": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
}
```

Required: [Create a GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope.

### Filesystem

```json
"filesystem": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/your/project/path"]
}
```

Replace `/your/project/path` with the root directory you want Coco to access. This path is machine-specific — do not commit it to source control if the path is personal.

### PostgreSQL

```json
"postgres": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"]
}
```

### Memory (persistent context)

```json
"memory": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-memory"]
}
```

### Context7 (live library docs)

```json
"context7": {
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp@latest"]
}
```

### Web search / Firecrawl

```json
"firecrawl": {
  "command": "npx",
  "args": ["-y", "firecrawl-mcp"],
  "env": { "FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}" }
}
```

### Vercel

```json
"vercel": {
  "url": "https://mcp.vercel.com/api",
  "headers": { "Authorization": "Bearer ${VERCEL_TOKEN}" }
}
```

---

## REPL commands

These commands are available inside the Coco interactive session:

| Command | Description |
|---------|-------------|
| `/mcp list` | List all configured servers |
| `/mcp status` | Show connected servers and tool counts |
| `/mcp health` | Health check on all servers |
| `/mcp health <name>` | Health check on a specific server |
| `/mcp restart <name>` | Restart a specific server |

---

## CLI commands

```bash
coco mcp add <name> --command "npx" --args "-y,@server/package"
coco mcp add <name> --transport http --url "https://..."
coco mcp remove <name>
coco mcp list
coco mcp list --all      # includes disabled servers
coco mcp enable <name>
coco mcp disable <name>
```

---

## Tool naming

MCP tools registered in Coco are prefixed:

```
mcp_<server-name>_<tool-name>
```

Examples:
- `mcp_github_create_pull_request`
- `mcp_filesystem_read_file`
- `mcp_postgres_query`

You can reference them in tasks: "use `mcp_github_create_pull_request` to open a PR".

---

## Global MCP config

For servers you want available in all projects, register them via the CLI:

```bash
coco mcp add memory \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-memory" \
  --description "Persistent memory across sessions"
```

Global registrations are stored in `~/.coco/mcp-registry.json` and loaded automatically in every session.

To see all globally registered servers:

```bash
coco mcp list --all
```

---

## Troubleshooting

### Server does not appear in `/mcp status`

1. Check `.mcp.json` is valid JSON: `cat .mcp.json | node -e "process.stdin.resume();process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{JSON.parse(d);console.log('valid')})"`
2. Verify the command exists: `which npx`
3. Test the server manually: `npx -y @modelcontextprotocol/server-github` (should start without error)

### Authentication errors

1. Verify the env var is set: `echo $GITHUB_TOKEN`
2. Make sure the token has the right permissions for the server
3. For HTTP servers, check the Authorization header format matches what the server expects

### Server starts but no tools appear

1. Run `/mcp health <name>` to see the error
2. Some servers require specific env vars before they expose tools — check the server's README
3. Check server logs: run the command manually in a terminal

### `.mcp.json` in source control

It is safe to commit `.mcp.json` as long as it uses `${ENV_VAR}` references and not hardcoded tokens. Machine-specific paths (like filesystem server paths) should be registered globally via `coco mcp add` instead of committed to `.mcp.json`.

---

## Resources

- [MCP Specification](https://modelcontextprotocol.io/)
- [Official MCP Servers](https://github.com/modelcontextprotocol/servers)
- [Skills Guide](guides/SKILLS.md)
- [Configuration Guide](guides/CONFIGURATION.md)
