// Normalized capability model for Cerebro REST (+ static MCP hints).

import type { CerebroCapability, CerebroGuideResponse } from './types.js';

/** Baseline REST capabilities always present when token auth works. */
export const BASE_REST_CAPABILITIES: CerebroCapability[] = [
  {
    id: 'rest:whoami',
    kind: 'lookup',
    transport: 'rest',
    description: 'Validate token and identify principal',
    readOnly: true,
  },
  {
    id: 'rest:guide-api',
    kind: 'schemaDiscovery',
    transport: 'rest',
    description: 'Fetch live REST endpoint guide',
    readOnly: true,
  },
  {
    id: 'rest:guide-mcp',
    kind: 'schemaDiscovery',
    transport: 'rest',
    description: 'Fetch MCP tool vocabulary guide',
    readOnly: true,
  },
  {
    id: 'rest:account-details',
    kind: 'lookup',
    transport: 'rest',
    description: 'Account drill-down (health risks, risk category) via POST /api/accounts/details',
    readOnly: true,
  },
  {
    id: 'rest:openapi',
    kind: 'schemaDiscovery',
    transport: 'rest',
    description: 'Interactive OpenAPI at /docs',
    readOnly: true,
  },
];

/** Documented MCP scopes; tool names require authenticated MCP discovery. */
export const DOCUMENTED_MCP_HINTS: CerebroCapability[] = [
  {
    id: 'mcp:tools',
    kind: 'aiToolInvocation',
    transport: 'mcp',
    description: 'MCP tools (OAuth scope mcp:tools) — discover via IDE after Cerebro Engage login',
    readOnly: true,
  },
  {
    id: 'mcp:resources',
    kind: 'readOnlyTools',
    transport: 'mcp',
    description: 'MCP resources (OAuth scope mcp:resources)',
    readOnly: true,
  },
];

export function mapCerebroCapabilities(
  apiGuide?: CerebroGuideResponse,
): CerebroCapability[] {
  const caps = [...BASE_REST_CAPABILITIES, ...DOCUMENTED_MCP_HINTS];
  if (apiGuide?.guide && typeof apiGuide.guide === 'object') {
    caps.push({
      id: 'rest:guide-dynamic',
      kind: 'schemaDiscovery',
      transport: 'rest',
      description: 'Server-published REST guide loaded at runtime',
      readOnly: true,
    });
  }
  return caps;
}
