import { createHash } from 'node:crypto';
import {
  DynamoDBClient,
  QueryCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { cognitoSubFromVerifiedAuth0Subject } from './cognito-owner.ts';

const dynamodb = new DynamoDBClient({});

type QueryPage = Pick<QueryCommandOutput, 'Items' | 'LastEvaluatedKey'>;
type QueryPageFn = (input: QueryCommandInput) => Promise<QueryPage>;

export type SyntheticFoodEntrySummary = {
  id: string;
  date: string;
  name: string;
  calories: number;
};

/**
 * Synthetic-only identity key.
 *
 * This is deliberately NOT the Amplify owner field and NOT the
 * <sub>::<sub> OwnershipProbe representation. It must never be assumed to
 * describe ownership of FoodEntry, Vital, DailyTarget, or any health model.
 */
export function syntheticFoodIdentityKeyFromVerifiedAuth0Subject(
  subject: unknown,
): string {
  const cognitoSub = cognitoSubFromVerifiedAuth0Subject(subject);
  return createHash('sha256')
    .update(`blix-synthetic-food-v1:${cognitoSub}`)
    .digest('hex');
}

/**
 * Read ONLY a synthetic food-entry table.
 *
 * The caller cannot supply an identity/owner key. It is derived server-side
 * from the already-verified Auth0 subject. The query returns only a minimal
 * synthetic projection.
 */
export async function listSyntheticFoodEntries(
  verifiedAuth0Subject: unknown,
  tableName: string,
  identityIndexName: string,
  queryPage: QueryPageFn = (input) => dynamodb.send(new QueryCommand(input)),
): Promise<SyntheticFoodEntrySummary[]> {
  // Resolve/validate identity before any DynamoDB access.
  const identityKey =
    syntheticFoodIdentityKeyFromVerifiedAuth0Subject(verifiedAuth0Subject);

  if (!tableName.trim()) throw new Error('Synthetic table not configured');
  if (!identityIndexName.trim()) throw new Error('Synthetic index not configured');

  const results: SyntheticFoodEntrySummary[] = [];
  let next: QueryCommandOutput['LastEvaluatedKey'];

  do {
    const page = await queryPage({
      TableName: tableName,
      IndexName: identityIndexName,
      ConsistentRead: false,
      KeyConditionExpression: '#identityKey = :identityKey',
      ExpressionAttributeNames: {
        '#identityKey': 'identityKey',
        '#id': 'id',
        '#date': 'date',
        '#name': 'name',
        '#calories': 'calories',
      },
      ExpressionAttributeValues: {
        ':identityKey': { S: identityKey },
      },
      ProjectionExpression: '#id, #date, #name, #calories',
      ...(next ? { ExclusiveStartKey: next } : {}),
    });

    for (const item of page.Items ?? []) {
      const id = item.id?.S;
      const date = item.date?.S;
      const name = item.name?.S;
      const caloriesRaw = item.calories?.N;

      if (
        typeof id !== 'string' ||
        typeof date !== 'string' ||
        typeof name !== 'string' ||
        typeof caloriesRaw !== 'string'
      ) {
        // Fail closed instead of returning malformed/unexpected attributes.
        throw new Error('Malformed synthetic food entry');
      }

      const calories = Number(caloriesRaw);
      if (!Number.isFinite(calories)) {
        throw new Error('Malformed synthetic food entry');
      }

      results.push({ id, date, name, calories });
    }

    next = page.LastEvaluatedKey;
  } while (next);

  return results;
}
