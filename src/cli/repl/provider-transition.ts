import { createProvider } from "../../providers/index.js";
import type { LLMProvider } from "../../providers/types.js";
import { getInternalProviderId, saveProviderPreference } from "../../config/env.js";
import type { ReplConfig, ReplSession } from "./types.js";

/** Commit the tested adapter once; roll back the full active configuration on failure. */
export async function activateSessionProvider(
  session: ReplSession,
  previousConfig: ReplConfig["provider"],
  previousProvider: LLMProvider,
): Promise<LLMProvider> {
  const pending = session.pendingProvider;
  delete session.pendingProvider;
  try {
    const internal = getInternalProviderId(
      session.config.provider.type,
      session.config.provider.authMethod,
    );
    const matches =
      pending?.userFacingType === session.config.provider.type &&
      pending.model === session.config.provider.model &&
      pending.internalType === internal;
    const next = matches
      ? pending.instance
      : await createProvider(internal, {
          model: session.config.provider.model || undefined,
          maxTokens: session.config.provider.maxTokens,
          project: session.config.provider.project,
          location: session.config.provider.location,
        });
    if (!matches && !(await next.isAvailable()))
      throw new Error("Selected provider/model is unavailable");
    session.runtime?.updateProvider(internal, session.config.provider.model || undefined, next);
    return next;
  } catch (error) {
    session.config.provider = { ...previousConfig };
    session.runtime?.updateProvider(
      getInternalProviderId(previousConfig.type, previousConfig.authMethod),
      previousConfig.model || undefined,
      previousProvider,
    );
    try {
      await saveProviderPreference(previousConfig.type, previousConfig.model, {
        project: previousConfig.project,
        location: previousConfig.location,
        authMethod: previousConfig.authMethod,
      });
    } catch {
      throw new Error(
        "Provider switch failed; active configuration restored but saving the previous preference failed",
      );
    }
    throw error;
  }
}
