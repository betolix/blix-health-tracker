import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  amplifyOwnerFromVerifiedAuth0Subject,
  cognitoSubFromVerifiedAuth0Subject,
  syntheticProbeOwnerFromVerifiedAuth0Subject,
} from './cognito-owner.ts';

const A = '11111111-2222-3333-4444-555555555555';
const B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const subject = (sub: string) => `oidc|blix-cognito|${sub}`;

test('resolves two different federated Cognito subjects without email', () => {
  assert.equal(cognitoSubFromVerifiedAuth0Subject(subject(A)), A);
  assert.equal(cognitoSubFromVerifiedAuth0Subject(subject(B)), B);
  assert.notEqual(
    syntheticProbeOwnerFromVerifiedAuth0Subject(subject(A)),
    syntheticProbeOwnerFromVerifiedAuth0Subject(subject(B)),
  );
});

test('formats ONLY the confirmed synthetic probe owner shape', () => {
  assert.equal(syntheticProbeOwnerFromVerifiedAuth0Subject(subject(A)), `${A}::${A}`);
});

test('derives the confirmed Amplify owner from verified federated identity only', () => {
  assert.equal(amplifyOwnerFromVerifiedAuth0Subject(subject(A)), `${A}::${A}`);
  assert.equal(amplifyOwnerFromVerifiedAuth0Subject(subject(B)), `${B}::${B}`);
  assert.notEqual(
    amplifyOwnerFromVerifiedAuth0Subject(subject(A)),
    amplifyOwnerFromVerifiedAuth0Subject(subject(B)),
  );
});

test('rejects absent, unrelated, malformed, or manipulated identities', () => {
  for (const value of [
    undefined,
    null,
    '',
    subject(''),
    A,
    `auth0|${A}`,
    `oidc|other-connection|${A}`,
    `oidc|blix-cognito|${A}|extra`,
    `oidc|blix-cognito|${A}::${B}`,
    subject(B.toUpperCase()),
    subject(A) + ' ',
    'oidc|blix-cognito|../../owner',
  ]) {
    assert.throws(() => cognitoSubFromVerifiedAuth0Subject(value));
  }
});

test('errors do not echo the supplied subject', () => {
  const untrusted = 'oidc|blix-cognito|secret-not-a-uuid';
  assert.throws(
    () => cognitoSubFromVerifiedAuth0Subject(untrusted),
    (error: unknown) => error instanceof Error && !error.message.includes(untrusted),
  );
});

test('Amplify owner derivation fails closed for untrusted identities', () => {
  for (const value of [
    undefined,
    null,
    '',
    A,
    `auth0|${A}`,
    `oidc|other-connection|${A}`,
    `oidc|blix-cognito|${A}|extra`,
    `oidc|blix-cognito|${A}::${B}`,
    subject(B.toUpperCase()),
    subject(A) + ' ',
  ]) {
    assert.throws(() => amplifyOwnerFromVerifiedAuth0Subject(value));
  }
});

test('Amplify owner errors never expose supplied identity material', () => {
  const untrusted = 'oidc|blix-cognito|private-invalid-identity';

  assert.throws(
    () => amplifyOwnerFromVerifiedAuth0Subject(untrusted),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes(untrusted),
  );
});
