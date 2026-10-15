export const PROBE_SCOPE = 'probe:identity';
export const FOOD_READ_SCOPE = 'food:read';
export const FOOD_CREATE_SCOPE = 'food:create';
export const FOOD_UPDATE_SCOPE = 'food:update';
export const FOOD_DELETE_SCOPE = 'food:delete';
export const VITAL_READ_SCOPE = 'vitals:read';
export const DAILY_TARGET_READ_SCOPE = 'targets:read';

export class InsufficientOAuthScopeError extends Error {
  constructor() {
    super('Insufficient OAuth scope');
  }
}

export function requireOAuthScope(
  grantedScope: unknown,
  requiredScope: string,
): void {
  if (
    typeof grantedScope !== 'string' ||
    typeof requiredScope !== 'string' ||
    requiredScope.length === 0
  ) {
    throw new InsufficientOAuthScopeError();
  }

  const grantedScopes = grantedScope
    .split(/\s+/)
    .filter(Boolean);

  if (!grantedScopes.includes(requiredScope)) {
    throw new InsufficientOAuthScopeError();
  }
}
