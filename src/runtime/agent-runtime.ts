import { setAgentProvider, setAgentToolRegistry } from "../agents/provider-bridge.js";
import { listAgentModes } from "../cli/repl/modes.js";
import { createSessionStore } from "../cli/repl/sessions/storage.js";
import { getDefaultModel } from "../config/env.js";
import type { ProviderType } from "../providers/index.js";
import type { LLMProvider } from "../providers/types.js";
import { createFullToolRegistry } from "../tools/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import { createEventLog, createFileEventLog } from "./event-log.js";
import { createPermissionPolicy } from "./permission-policy.js";
import { createProviderRegistry, ProviderRegistry } from "./provider-registry.js";
import type {
  AgentRuntimeOptions,
  AgentRuntimeSnapshot,
  EventLog,
  PermissionPolicy,
  RuntimeMode,
} from "./types.js";

/**
 * Reusable runtime facade for wiring providers, tools, permissions, sessions,
 * and observability. It does not own the CLI loop; CLI/headless are adapters on
 * top of this boundary.
 */
export class AgentRuntime {
  readonly providerRegistry: ProviderRegistry;
  readonly toolRegistry: ToolRegistry;
  readonly sessionStore;
  readonly permissionPolicy: PermissionPolicy;
  readonly eventLog: EventLog;
  private providerType: ProviderType;
  private model: string;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.providerRegistry = createProviderRegistry();
    this.toolRegistry = options.toolRegistry ?? createFullToolRegistry();
    this.sessionStore = options.sessionStore ?? createSessionStore({});
    this.permissionPolicy = options.permissionPolicy ?? createPermissionPolicy();
    this.eventLog =
      options.eventLog ??
      (options.eventLogPath ? createFileEventLog(options.eventLogPath) : createEventLog());
    this.providerType = options.providerType;
    this.model =
      options.model ?? options.providerConfig?.model ?? getDefaultModel(options.providerType);
  }

  async initialize(): Promise<void> {
    const providerInjected = Boolean(this.options.provider);
    const provider =
      this.options.provider ??
      (await this.providerRegistry.createProvider(this.providerType, {
        ...this.options.providerConfig,
        model: this.getModel(),
      }));

    this.publishToGlobalBridge(provider);

    this.eventLog.record(providerInjected ? "provider.attached" : "provider.created", {
      provider: this.providerType,
      model: this.getModel(),
      createdByRuntime: !providerInjected,
    });
    this.eventLog.record("runtime.initialized", { snapshot: this.snapshot() });
  }

  getModel(): string {
    return this.model;
  }

  updateProvider(
    providerType: ProviderType,
    model: string | undefined,
    provider: LLMProvider,
  ): void {
    this.providerType = providerType;
    this.model = model ?? getDefaultModel(providerType);
    this.publishToGlobalBridge(provider);
    this.eventLog.record("provider.updated", {
      provider: this.providerType,
      model: this.model,
    });
  }

  private publishToGlobalBridge(provider: LLMProvider): void {
    if (this.options.publishToGlobalBridge !== true) return;
    setAgentProvider(provider);
    setAgentToolRegistry(this.toolRegistry);
  }

  snapshot(): AgentRuntimeSnapshot {
    const capability = this.providerRegistry.getCapability(this.providerType, this.getModel());
    const toolNames = this.toolRegistry
      .getAll()
      .map((tool) => tool.name)
      .sort();

    return {
      provider: {
        type: this.providerType,
        model: this.getModel(),
        capability,
      },
      tools: {
        count: toolNames.length,
        names: toolNames,
      },
      modes: listAgentModes(),
    };
  }

  assertToolAllowed(mode: RuntimeMode, toolName: string): boolean {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      this.eventLog.record("tool.blocked", {
        mode,
        tool: toolName,
        reason: "Tool not registered.",
      });
      return false;
    }

    const decision = this.permissionPolicy.canExecuteTool(mode, tool);
    this.eventLog.record(decision.allowed ? "tool.allowed" : "tool.blocked", {
      mode,
      tool: toolName,
      ...decision,
    });
    return decision.allowed;
  }
}

export async function createAgentRuntime(options: AgentRuntimeOptions): Promise<AgentRuntime> {
  const runtime = new AgentRuntime(options);
  await runtime.initialize();
  return runtime;
}
