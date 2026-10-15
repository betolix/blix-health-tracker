import {
  QueryCommand,
  type AttributeValue,
  type QueryCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { amplifyOwnerFromVerifiedAuth0Subject } from './cognito-owner.ts';

export const FOOD_ENTRY_READ_INDEX_NAME = 'byOwnerAndDate';
export const MAX_FOOD_ENTRY_READ_RESULTS = 100;

const MAX_DATE_RANGE_DAYS = 31;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type FoodEntryReadInput = {
  verifiedSubject: unknown;
  from: string;
  to: string;
};

export type FoodEntryReadResult = {
  date: string;
  name: string;
  calories: number;
};

type QuerySender = (
  command: QueryCommand,
) => Promise<Pick<QueryCommandOutput, 'Items' | 'LastEvaluatedKey'>>;

type FoodEntryReadDependencies = {
  tableName: string;
  send: QuerySender;
};

function parseIsoDate(value: unknown): number {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new Error('Invalid date range');
  }

  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('Invalid date range');
  }

  return timestamp;
}

function validateDateRange(from: unknown, to: unknown): {
  from: string;
  to: string;
} {
  const fromTime = parseIsoDate(from);
  const toTime = parseIsoDate(to);

  if (toTime < fromTime) {
    throw new Error('Invalid date range');
  }

  const days = Math.floor((toTime - fromTime) / 86_400_000) + 1;

  if (days > MAX_DATE_RANGE_DAYS) {
    throw new Error('Date range exceeds maximum');
  }

  return {
    from: from as string,
    to: to as string,
  };
}

function stringAttribute(
  value: AttributeValue | undefined,
): string | undefined {
  return value && 'S' in value ? value.S : undefined;
}

function numberAttribute(
  value: AttributeValue | undefined,
): number | undefined {
  if (!value || !('N' in value) || typeof value.N !== 'string') {
    return undefined;
  }

  const parsed = Number(value.N);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeRow(
  row: Record<string, AttributeValue>,
): FoodEntryReadResult {
  const date = stringAttribute(row.date);
  const name = stringAttribute(row.name);
  const calories = numberAttribute(row.calories);

  if (
    typeof date !== 'string' ||
    !ISO_DATE.test(date) ||
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    typeof calories !== 'number'
  ) {
    throw new Error('Invalid FoodEntry row');
  }

  parseIsoDate(date);

  return {
    date,
    name,
    calories,
  };
}

export async function readFoodEntries(
  input: FoodEntryReadInput,
  dependencies: FoodEntryReadDependencies,
): Promise<FoodEntryReadResult[]> {
  if (
    typeof dependencies.tableName !== 'string' ||
    dependencies.tableName.trim().length === 0 ||
    typeof dependencies.send !== 'function'
  ) {
    throw new Error('Invalid FoodEntry reader configuration');
  }

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );
  const { from, to } = validateDateRange(input.from, input.to);

  const results: FoodEntryReadResult[] = [];
  let exclusiveStartKey:
    | Record<string, AttributeValue>
    | undefined;

  do {
    const remaining =
      MAX_FOOD_ENTRY_READ_RESULTS - results.length;

    if (remaining <= 0) {
      break;
    }

    const response = await dependencies.send(
      new QueryCommand({
        TableName: dependencies.tableName,
        IndexName: FOOD_ENTRY_READ_INDEX_NAME,
        KeyConditionExpression:
          '#owner = :owner AND #date BETWEEN :from AND :to',
        ExpressionAttributeNames: {
          '#owner': 'owner',
          '#date': 'date',
          '#name': 'name',
        },
        ExpressionAttributeValues: {
          ':owner': { S: owner },
          ':from': { S: from },
          ':to': { S: to },
        },
        ProjectionExpression: '#date, #name, calories',
        Limit: remaining,
        ...(exclusiveStartKey
          ? { ExclusiveStartKey: exclusiveStartKey }
          : {}),
      }),
    );

    for (const row of response.Items ?? []) {
      if (results.length >= MAX_FOOD_ENTRY_READ_RESULTS) {
        break;
      }

      results.push(sanitizeRow(row));
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (
    exclusiveStartKey &&
    results.length < MAX_FOOD_ENTRY_READ_RESULTS
  );

  return results;
}
