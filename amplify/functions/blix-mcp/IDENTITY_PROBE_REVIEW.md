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

## Before considering deployment (separate explicit approval required)

1. Validate `npm ci`, isolated backend TypeScript check, and MCP Inspector
   against the actual installed SDK. The existing v1 SDK may need migration
   for current ChatGPT `securitySchemes`/tool-level auth signaling.
2. Add synthetic JWT tests: valid A and B have different fingerprints; invalid
   signature, issuer, audience, `azp`, expiry, algorithm, missing scope, and
   missing pinned client ID all fail closed. Do not paste live tokens anywhere.
3. Check the Auth0 API token's real claim shape (`azp`, `scope`, `aud`) locally
   without exposing a live token. Do not infer Cognito ownership from Auth0 sub.
4. Configure `BLIX_AUTH0_CIMD_CLIENT_ID` with the Auth0-generated internal
   Client ID of the **ChatGPT CIMD** app (not a secret and not the external
   `https://chatgpt.com/oauth/client.json` URL).
5. Explicitly approve a separate change to `resource.ts` only after review,
   including complete OAuth/MCP handshake and user A/B isolation testing.

## Expected negative behavior today

- Public GET `/.well-known/oauth-protected-resource`: HTTP 200, unchanged.
- Public `/` and `/mcp`: HTTP 503, unchanged.
- No remote MCP tools are available.
