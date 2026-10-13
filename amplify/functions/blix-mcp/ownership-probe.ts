import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { ScanCommandInput, ScanCommandOutput } from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient({});
type ScanPage = Pick<ScanCommandOutput, 'Count' | 'LastEvaluatedKey'>;
type ScanPageFn = (input: ScanCommandInput) => Promise<ScanPage>;

/** Read ONLY synthetic OwnershipProbe, never return item contents. */
export async function countMatchingSyntheticProbeRows(
  owner: string,
  tableName: string,
  scanPage: ScanPageFn = (input) => dynamodb.send(new ScanCommand(input)),
): Promise<number> {
  // Matches the observed synthetic owner shape, not a general health owner rule.
  if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})::\1$/.test(owner)) {
    throw new Error('Invalid synthetic owner');
  }
  if (!tableName.trim()) throw new Error('Probe table not configured');
  let count = 0;
  let next: ScanCommandOutput['LastEvaluatedKey'];
  do {
    const page = await scanPage({
      TableName: tableName,
      ConsistentRead: true,
      Select: 'COUNT',
      FilterExpression: '#owner = :expectedOwner',
      ExpressionAttributeNames: { '#owner': 'owner' },
      ExpressionAttributeValues: { ':expectedOwner': { S: owner } },
      ...(next ? { ExclusiveStartKey: next } : {}),
    });
    count += page.Count ?? 0;
    next = page.LastEvaluatedKey;
  } while (next);
  return count;
}
