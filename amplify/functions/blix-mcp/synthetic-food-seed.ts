import { randomUUID } from 'node:crypto';
import {
  DynamoDBClient,
  PutItemCommand,
  type PutItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { syntheticFoodIdentityKeyFromVerifiedAuth0Subject } from './synthetic-food-entry-probe.ts';

const dynamodb = new DynamoDBClient({});

type PutItemFn = (input: PutItemCommandInput) => Promise<unknown>;
type IdFactory = () => string;

const SYNTHETIC_ROWS = [
  { date: '2099-01-01', name: '[SYNTHETIC] Apple', calories: 95 },
  { date: '2099-01-02', name: '[SYNTHETIC] Sandwich', calories: 420 },
  { date: '2099-01-03', name: '[SYNTHETIC] Coffee', calories: 5 },
] as const;

/**
 * Seed ONLY the isolated synthetic food table.
 *
 * No owner/identity key or row contents are accepted from the caller.
 * Identity is derived server-side from the already-verified Auth0 subject.
 * The derived key is written to DynamoDB but is never returned.
 */
export async function seedSyntheticFoodEntries(
  verifiedAuth0Subject: unknown,
  tableName: string,
  putItem: PutItemFn = (input) => dynamodb.send(new PutItemCommand(input)),
  idFactory: IdFactory = randomUUID,
): Promise<number> {
  // Resolve/validate identity before any DynamoDB access.
  const identityKey =
    syntheticFoodIdentityKeyFromVerifiedAuth0Subject(verifiedAuth0Subject);

  if (!tableName.trim()) throw new Error('Synthetic table not configured');

  for (const row of SYNTHETIC_ROWS) {
    await putItem({
      TableName: tableName,
      Item: {
        id: { S: idFactory() },
        identityKey: { S: identityKey },
        date: { S: row.date },
        name: { S: row.name },
        calories: { N: String(row.calories) },
      },
      ConditionExpression: 'attribute_not_exists(#id)',
      ExpressionAttributeNames: { '#id': 'id' },
    });
  }

  return SYNTHETIC_ROWS.length;
}
