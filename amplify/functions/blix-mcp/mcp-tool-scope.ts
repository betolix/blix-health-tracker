import {
  DAILY_TARGET_READ_SCOPE,
  FOOD_READ_SCOPE,
  PROBE_SCOPE,
  VITAL_READ_SCOPE,
} from './oauth-scope.ts';

const TOOL_SCOPE = {
  identity_probe: PROBE_SCOPE,
  ownership_probe: PROBE_SCOPE,
  food_entries_probe: PROBE_SCOPE,
  read_food_entries: FOOD_READ_SCOPE,
  read_vitals: VITAL_READ_SCOPE,
  read_daily_targets: DAILY_TARGET_READ_SCOPE,
} as const;

export class UnknownProtectedToolError extends Error {
  constructor() {
    super('Unknown protected tool');
  }
}

export function requiredOAuthScopeForTool(
  toolName: unknown,
): string {
  if (
    typeof toolName !== 'string' ||
    !Object.prototype.hasOwnProperty.call(TOOL_SCOPE, toolName)
  ) {
    throw new UnknownProtectedToolError();
  }

  return TOOL_SCOPE[toolName as keyof typeof TOOL_SCOPE];
}
