import {
  QueryCommand,
  type AttributeValue,
  type QueryCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { amplifyOwnerFromVerifiedAuth0Subject } from './cognito-owner.ts';

export const VITAL_READ_INDEX_NAME = 'byOwnerAndRecordedAt';
export const MAX_VITAL_READ_RESULTS = 100;

const MAX_DATE_RANGE_DAYS = 31;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type VitalReadInput = {
  verifiedSubject: unknown;
  from: string;
  to: string;
};

export type VitalReadResult = {
  recordedAt: string;
  weightKg?: number;
  systolic?: number;
  diastolic?: number;
};

type QuerySender = (
  command: QueryCommand,
) => Promise<Pick<QueryCommandOutput, 'Items' | 'LastEvaluatedKey'>>;

type VitalReadDependencies = {
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

  if (toTime < fromTime) {
    throw new Error('Invalid date range');
  }

  const days = Math.floor((toTime - fromTime) / 86_400_000) + 1;

  if (days > MAX_DATE_RANGE_DAYS) {
    throw new Error('Date range exceeds maximum');
  }

  return {
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.999Z`,
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
): VitalReadResult {
  const recordedAt = stringAttribute(row.recordedAt);

  if (
    typeof recordedAt !== 'string' ||
    !Number.isFinite(Date.parse(recordedAt))
  ) {
    throw new Error('Invalid Vital row');
  }

  const weightKg = numberAttribute(row.weightKg);
  const systolic = numberAttribute(row.systolic);
  const diastolic = numberAttribute(row.diastolic);

  if (
    systolic !== undefined && !Number.isInteger(systolic) ||
    diastolic !== undefined && !Number.isInteger(diastolic)
  ) {
    throw new Error('Invalid Vital row');
  }

  return {
    recordedAt,
    ...(weightKg !== undefined ? { weightKg } : {}),
    ...(systolic !== undefined ? { systolic } : {}),
    ...(diastolic !== undefined ? { diastolic } : {}),
  };
}

export async function readVitals(
  input: VitalReadInput,
  dependencies: VitalReadDependencies,
): Promise<VitalReadResult[]> {
  if (
    typeof dependencies.tableName !== 'string' ||
    !dependencies.tableName.trim() ||
    typeof dependencies.send !== 'function'
  ) {
    throw new Error('Invalid Vital reader configuration');
  }

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );

  const { from, to } = validateDateRange(input.from, input.to);

  const results: VitalReadResult[] = [];
  let exclusiveStartKey:
    | Record<string, AttributeValue>
    | undefined;

  do {
    const remaining = MAX_VITAL_READ_RESULTS - results.length;

    if (remaining <= 0) break;

    const response = await dependencies.send(
      new QueryCommand({
        TableName: dependencies.tableName,
        IndexName: VITAL_READ_INDEX_NAME,
        KeyConditionExpression:
          '#owner = :owner AND #recordedAt BETWEEN :from AND :to',
        ExpressionAttributeNames: {
          '#owner': 'owner',
          '#recordedAt': 'recordedAt',
        },
        ExpressionAttributeValues: {
          ':owner': { S: owner },
          ':from': { S: from },
          ':to': { S: to },
        },
        ProjectionExpression:
          '#recordedAt, weightKg, systolic, diastolic',
        Limit: remaining,
        ...(exclusiveStartKey
          ? { ExclusiveStartKey: exclusiveStartKey }
          : {}),
      }),
    );

    for (const row of response.Items ?? []) {
      if (results.length >= MAX_VITAL_READ_RESULTS) break;
      results.push(sanitizeRow(row));
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (
    exclusiveStartKey &&
    results.length < MAX_VITAL_READ_RESULTS
  );

  return results;
}
