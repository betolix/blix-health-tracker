# PR #6 — Auth0 identity probe (NOT deployed)

This change adds a separate, test-only MCP handler. The deployed Amplify entry point
MUST remain `./disabled-handler.ts` in `amplify/functions/blix-mcp/resource.ts`.
No production HTTP behavior changes from this patch.

## Scope

- Only tool: `identity_probe` (read-only; returns `authenticated` and a
  pseudonymous, stable Auth0-sub fingerprint).
- Auth0 RS256 JWT checked with public JWKS, exact issuer, exact API audience,
  expiration and issued-at, `probe:identity`, and pinned Auth0 application `azp`.
- No health models, no data client, no DynamoDB permissions, no Cognito owner mapping.
- Existing `add_food` implementation is not imported or exposed.

## Verified locally

- Synthetic JWT verification passes for:
  - valid RS256 token
  - missing `probe:identity`
  - wrong audience
  - wrong `azp`
  - expired token
  - wrong issuer
  - invalid signature
  - non-RS256 algorithm
  - missing `iat`
  - missing `sub`
  - missing pinned client configuration
- Synthetic identities A and B produce different fingerprints; the same identity
  produces a stable fingerprint.
- HTTP negative-path tests pass for metadata, unknown paths, unsupported methods,
  missing Authorization, non-Bearer Authorization, and ambiguous duplicate
  Authorization headers.
- The installed MCP SDK can transmit probe-only OAuth metadata through
  `_meta.securitySchemes` and can return `mcp/www_authenticate`.
- Synthetic MCP server tests pass for tool discovery, unauthenticated challenge,
  and authenticated identity-probe execution.
- The complete synthetic authenticated HTTP -> MCP path passes:
  `initialize` -> `tools/list` -> `identity_probe`.
- Isolated TypeScript compilation passes for the identity-probe implementation
  and synthetic tests.
- No live Auth0 token, client secret, ID token, refresh token, or health record
  was used in these tests.

## Still required before deployment

1. Verify the real Auth0 access-token claim shape for the **ChatGPT CIMD** flow,
   especially `iss`, `aud`, `azp`, and `scope`, without exposing the token or
   raw `sub`. Do not infer Cognito ownership from Auth0 `sub`.
2. Configure `BLIX_AUTH0_CIMD_CLIENT_ID` with the Auth0-generated internal
   Client ID of the **ChatGPT CIMD** app (not a secret and not the external
   `https://chatgpt.com/oauth/client.json` URL).
3. Test the remote OAuth/MCP handshake with the actual ChatGPT connection,
   including MCP Inspector/current-client compatibility as appropriate.
4. Perform user A/B OAuth identity-isolation testing before any health access.
5. Resolve or separately account for the pre-existing `npm ci` lockfile
   inconsistency; PR #6 did not introduce or modify that dependency state.
6. Explicitly approve a separate deployment change to `resource.ts`.
7. Health scopes and health read/write functionality remain out of scope until
   a later explicit review and approval.

## Expected negative behavior today

- Public GET `/.well-known/oauth-protected-resource`: HTTP 200, unchanged.
- Public `/` and `/mcp`: HTTP 503, unchanged.
- No remote MCP tools are available.
