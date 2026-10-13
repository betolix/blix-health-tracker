# PR #8 proposal — mixed-auth MCP discovery (NOT deployed)

## Why
ChatGPT installed the OAuth-connected `Blix Identity Probe` plugin, but showed
`No tools available for this app`. The Lambda's handler currently rejects
unauthenticated `initialize` and `tools/list` before the MCP transport runs.
OpenAI documents an `OAuth or no authentication` mixed mode in which discovery
is anonymous and tool authorization is declared per tool.

## Change
- Allow anonymous `initialize`, `tools/list`, and `notifications/initialized`.
- Allow only an anonymous `tools/call` for `identity_probe` to reach the MCP
  server's existing auth challenge; it returns no fingerprint.
- Any supplied Authorization header must be a single valid Bearer token; invalid
  credentials are rejected, including during discovery.
- All other anonymous operations remain HTTP 401; unrelated paths stay disabled.
- The existing Auth0 RS256 signature/issuer/audience/azp/scope checks remain
  unchanged for authenticated requests.
- No health tools, data permissions, model imports, or health OAuth scopes.

## Test coverage proposed
`identity-probe-mixed-auth.synthetic-test.ts` checks anonymous discovery,
exactly one OAuth-protected tool, initialization notification, anonymous MCP
challenge, fail-closed unknown/health methods and malformed/batch requests,
invalid/insufficient credentials, and successful synthetic authenticated call.
Existing synthetic tests should also be rerun.

## Important remaining steps
- All five synthetic test suites passed in the actual repository with installed
  dependencies, including the mixed-auth discovery tests.
- `npx --no-install tsc --noEmit` completed with no errors.
- The ChatGPT plugin was created with **OAuth**, not **OAuth or no authentication**.
  After a separately approved deployment, the plugin may need to be recreated
  or reconfigured for mixed auth. Do not change scopes: only `openid` and
  `probe:identity` are expected.
- Check ChatGPT tool discovery and actual Auth0 JWT claim shape without
  exposing tokens or raw user IDs. Then test user B vs user A fingerprints.
- Do not merge or deploy until explicit review/approval.
