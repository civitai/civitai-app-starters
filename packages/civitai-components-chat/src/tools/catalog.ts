import type { McpConnection, McpTool } from '../mcp/clients.js';

/** Tools whose work the app runs as jobs and lists itself. */
export const DENIED_ORCHESTRATION_TOOLS = new Set(['get_workflow', 'cancel_workflow', 'list_workflows']);

/** Site tools the assistant may use; the rest post, comment or message as the user. */
export const ALLOWED_SITE_TOOLS = new Set(['search_models', 'get_model', 'get_model_version', 'search_images']);

/** The tools that run workflows; which service they run is in their input, not their name. */
const JOB_TOOLS = new Set(['run_step', 'run_workflow']);

export function isJobTool(name: string): boolean {
  return JOB_TOOLS.has(name);
}

/** Parameters the app sets itself on generation tools; the assistant never sees them. */
export const CONTROL_PARAMETERS = ['whatif', 'waitForCompletion', 'tags', 'metadataJson'];

export interface ToolCatalog {
  orchestration: McpTool[];
  /** `null` when the site MCP cannot be reached from this page (no CORS yet); empty when it is switched off. */
  site: McpTool[] | null;
}

export async function loadOrchestrationTools(orchestration: McpConnection): Promise<McpTool[]> {
  return (await orchestration.listTools()).filter((tool) => !DENIED_ORCHESTRATION_TOOLS.has(tool.name));
}

export async function loadSiteTools(site: McpConnection): Promise<McpTool[] | null> {
  try {
    return (await site.listTools()).filter((tool) => ALLOWED_SITE_TOOLS.has(tool.name));
  } catch (error) {
    console.warn('[chat-cvt] site MCP unreachable; using the public API for model search', error);
    return null;
  }
}

export function withoutControls(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = { ...((schema.properties ?? {}) as Record<string, unknown>) };
  for (const key of CONTROL_PARAMETERS) delete properties[key];
  const required = Array.isArray(schema.required)
    ? (schema.required as string[]).filter((key) => !CONTROL_PARAMETERS.includes(key))
    : undefined;
  const { $schema: _ignored, ...rest } = schema;
  return { ...rest, type: 'object', properties, ...(required ? { required } : {}) };
}
