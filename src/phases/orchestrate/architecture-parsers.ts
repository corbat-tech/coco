/**
 * Parsers for architecture data from LLM responses
 */

import { randomUUID } from "node:crypto";
import type {
  ArchitectureOverview,
  Component,
  Relationship,
  DataModel,
  Integration,
  ArchitecturePattern,
} from "./types.js";

/**
 * Raw overview data from LLM
 */
export interface RawOverview {
  pattern?: string;
  description?: string;
  principles?: string[];
  qualityAttributes?: Array<{
    name?: string;
    description?: string;
    priority?: string;
    tradeoffs?: string[];
  }>;
}

/**
 * Raw component data from LLM
 */
export interface RawComponent {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
  responsibilities?: string[];
  technology?: string;
  layer?: string;
  dependencies?: string[];
}

/**
 * Raw relationship data from LLM
 */
export interface RawRelationship {
  from?: string;
  to?: string;
  type?: string;
  description?: string;
}

/**
 * Raw data model data from LLM
 */
export interface RawDataModel {
  name?: string;
  description?: string;
  fields?: Array<{
    name?: string;
    type?: string;
    required?: boolean;
    description?: string;
  }>;
  relationships?: Array<{
    type?: string;
    target?: string;
    description?: string;
  }>;
}

/**
 * Raw integration data from LLM
 */
export interface RawIntegration {
  name?: string;
  type?: string;
  description?: string;
  endpoint?: string;
  authentication?: string;
}

/**
 * Parse overview from raw data
 */
export function parseOverview(data?: RawOverview): ArchitectureOverview {
  return {
    pattern: (data?.pattern as ArchitecturePattern) || "layered",
    description: data?.description || "System architecture",
    principles: data?.principles || [],
    qualityAttributes: (data?.qualityAttributes || []).map((qa) => ({
      name: qa.name || "",
      description: qa.description || "",
      priority: (qa.priority as "high" | "medium" | "low") || "medium",
      tradeoffs: qa.tradeoffs,
    })),
  };
}

/**
 * Parse components from raw data
 */
export function parseComponents(data: RawComponent[]): Component[] {
  return data.map((c) => ({
    id: c.id || randomUUID(),
    name: c.name || "Component",
    type: (c.type as Component["type"]) || "service",
    description: c.description || "",
    responsibilities: c.responsibilities || [],
    technology: c.technology,
    layer: c.layer,
    dependencies: c.dependencies || [],
  }));
}

/**
 * Parse relationships from raw data
 */
export function parseRelationships(data: RawRelationship[]): Relationship[] {
  return data.map((r) => ({
    from: r.from || "",
    to: r.to || "",
    type: (r.type as Relationship["type"]) || "uses",
    description: r.description,
  }));
}

/**
 * Parse data models from raw data
 */
export function parseDataModels(data: RawDataModel[]): DataModel[] {
  return data.map((dm) => ({
    name: dm.name || "Model",
    description: dm.description || "",
    fields: (dm.fields || []).map((f) => ({
      name: f.name || "",
      type: f.type || "string",
      required: f.required ?? true,
      description: f.description,
    })),
    relationships: (dm.relationships || []).map((r) => ({
      type: (r.type as DataModel["relationships"][0]["type"]) || "one_to_many",
      target: r.target || "",
      description: r.description,
    })),
  }));
}

/**
 * Parse integrations from raw data
 */
export function parseIntegrations(data: RawIntegration[]): Integration[] {
  return data.map((i) => ({
    name: i.name || "Integration",
    type: (i.type as Integration["type"]) || "rest_api",
    description: i.description || "",
    endpoint: i.endpoint,
    authentication: i.authentication,
  }));
}
