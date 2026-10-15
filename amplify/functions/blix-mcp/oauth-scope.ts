export const PROBE_SCOPE = 'probe:identity';
export const FOOD_READ_SCOPE = 'food:read';

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
