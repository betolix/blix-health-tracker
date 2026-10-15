import {
  QueryCommand,
  type AttributeValue,
  type QueryCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { amplifyOwnerFromVerifiedAuth0Subject } from './cognito-owner.ts';

export const DAILY_TARGET_READ_INDEX_NAME = 'byOwnerAndDate';
export const MAX_DAILY_TARGET_READ_RESULTS = 100;

const MAX_DATE_RANGE_DAYS = 31;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DailyTargetReadInput = {
  verifiedSubject: unknown;
  from: string;
  to: string;
};

export type DailyTargetReadResult = {
  date: string;
  calories: number;
  protein: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  targetWeightKg?: number;
};

type QuerySender = (
  command: QueryCommand,
) => Promise<Pick<QueryCommandOutput, 'Items' | 'LastEvaluatedKey'>>;

type DailyTargetReadDependencies = {
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

function validateDateRange(from: unknown, to: unknown) {
  const fromTime = parseIsoDate(from);
  const toTime = parseIsoDate(to);

  if (toTime < fromTime) throw new Error('Invalid date range');

  const days = Math.floor((toTime - fromTime) / 86_400_000) + 1;
  if (days > MAX_DATE_RANGE_DAYS) {
    throw new Error('Date range exceeds maximum');
  }
}

function stringAttribute(value: AttributeValue | undefined) {
  return value && 'S' in value ? value.S : undefined;
}

function numberAttribute(value: AttributeValue | undefined) {
  if (!value || !('N' in value) || typeof value.N !== 'string') {
    return undefined;
  }
  const parsed = Number(value.N);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeRow(
  row: Record<string, AttributeValue>,
): DailyTargetReadResult {
  const date = stringAttribute(row.date);
  const calories = numberAttribute(row.calories);
  const protein = numberAttribute(row.protein);

  if (
    typeof date !== 'string' ||
    !ISO_DATE.test(date) ||
    parseIsoDate(date) === undefined ||
    calories === undefined ||
    !Number.isInteger(calories) ||
    protein === undefined
  ) {
    throw new Error('Invalid DailyTarget row');
  }

  const carbs = numberAttribute(row.carbs);
  const fat = numberAttribute(row.fat);
  const fiber = numberAttribute(row.fiber);
  const targetWeightKg = numberAttribute(row.targetWeightKg);

  return {
    date,
    calories,
    protein,
    ...(carbs !== undefined ? { carbs } : {}),
    ...(fat !== undefined ? { fat } : {}),
    ...(fiber !== undefined ? { fiber } : {}),
    ...(targetWeightKg !== undefined ? { targetWeightKg } : {}),
  };
}

export async function readDailyTargets(
  input: DailyTargetReadInput,
  dependencies: DailyTargetReadDependencies,
): Promise<DailyTargetReadResult[]> {
  if (
    typeof dependencies.tableName !== 'string' ||
    !dependencies.tableName.trim() ||
    typeof dependencies.send !== 'function'
  ) {
    throw new Error('Invalid DailyTarget reader configuration');
  }

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );

  validateDateRange(input.from, input.to);

  const results: DailyTargetReadResult[] = [];
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;

  do {
    const remaining = MAX_DAILY_TARGET_READ_RESULTS - results.length;
    if (remaining <= 0) break;

    const response = await dependencies.send(
      new QueryCommand({
        TableName: dependencies.tableName,
        IndexName: DAILY_TARGET_READ_INDEX_NAME,
        KeyConditionExpression:
          '#owner = :owner AND #date BETWEEN :from AND :to',
        ExpressionAttributeNames: {
          '#owner': 'owner',
          '#date': 'date',
        },
        ExpressionAttributeValues: {
          ':owner': { S: owner },
          ':from': { S: input.from },
          ':to': { S: input.to },
        },
        ProjectionExpression:
          '#date, calories, protein, carbs, fat, fiber, targetWeightKg',
        Limit: remaining,
        ...(exclusiveStartKey
          ? { ExclusiveStartKey: exclusiveStartKey }
          : {}),
      }),
    );

    for (const row of response.Items ?? []) {
      if (results.length >= MAX_DAILY_TARGET_READ_RESULTS) break;
      results.push(sanitizeRow(row));
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (
    exclusiveStartKey &&
    results.length < MAX_DAILY_TARGET_READ_RESULTS
  );

  return results;
}
