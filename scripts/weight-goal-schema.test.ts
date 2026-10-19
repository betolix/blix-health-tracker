import assert from 'node:assert/strict';
import test from 'node:test';
import { data } from '../amplify/data/resource';

test('generated goal schema binds its unique key to the authenticated sub and rejects nonpositive goals', () => {
  // Inspect the schema actually handed to Amplify, including generated directives.
  const backend = data as unknown as { props: { schema: { transform(): { schema: string } } } };
  const schema = backend.props.schema.transform().schema;
  const goal = schema.match(/type WeightGoal\s+([^]*?)\n\{([^]*?)\n\}/);
  assert.ok(goal, 'WeightGoal is present in the generated schema');
  assert.match(goal[1], /@auth\(rules: \[\{allow: owner, ownerField: "userId", identityClaim: "sub"\}\]\)/);
  assert.match(goal[2], /userId: String! @primaryKey/);
  assert.match(goal[2], /targetWeightKg: Float! @validate\(type: gt, value: "0"\)/);
  assert.doesNotMatch(goal[1], /public|private|groups|iam|oidc/);
});
