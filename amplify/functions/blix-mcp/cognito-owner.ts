/**
 * Resolve the Cognito subject carried by Auth0's blix-cognito OIDC identity.
 *
 * Call ONLY after verifying the Auth0 API access token's signature, issuer,
 * audience, authorized OAuth client, timestamps and required scope.
 * This is identity resolution, not authorization to access a health record.
 */
const COGNITO_OIDC_SUB_PREFIX = 'oidc|blix-cognito|';
const COGNITO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function cognitoSubFromVerifiedAuth0Subject(subject: unknown): string {
  if (typeof subject !== 'string' || !subject.startsWith(COGNITO_OIDC_SUB_PREFIX)) {
    throw new Error('Unsupported federated identity');
  }

  const cognitoSub = subject.slice(COGNITO_OIDC_SUB_PREFIX.length);
  if (!COGNITO_UUID.test(cognitoSub)) {
    throw new Error('Invalid federated Cognito subject');
  }

  return cognitoSub;
}

/**
 * Existing SYNTHETIC OwnershipProbe rows use <sub>::<sub>.
 * Do not generalize this representation to health models or other users.
 */
export function syntheticProbeOwnerFromVerifiedAuth0Subject(subject: unknown): string {
  const cognitoSub = cognitoSubFromVerifiedAuth0Subject(subject);
  return `${cognitoSub}::${cognitoSub}`;
}
