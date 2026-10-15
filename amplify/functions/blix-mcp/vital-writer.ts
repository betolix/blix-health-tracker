import { randomUUID } from 'node:crypto';
import {
  DeleteItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type AttributeValue,
  type DeleteItemCommandOutput,
  type PutItemCommandOutput,
  type UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { amplifyOwnerFromVerifiedAuth0Subject } from './cognito-owner.ts';

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export type CreateVitalInput = {
  verifiedSubject: unknown;
  recordedAt: string;
  weightKg?: number;
  systolic?: number;
  diastolic?: number;
  notes?: string;
};

export type UpdateVitalInput = {
  verifiedSubject: unknown;
  id: string;
  recordedAt?: string;
  weightKg?: number | null;
  systolic?: number | null;
  diastolic?: number | null;
  notes?: string | null;
};

export type DeleteVitalInput = {
  verifiedSubject: unknown;
  id: string;
};

export type VitalWriteResult = {
  id: string;
};

type PutSender = (
  command: PutItemCommand,
) => Promise<Pick<PutItemCommandOutput, never>>;

type UpdateSender = (
  command: UpdateItemCommand,
) => Promise<Pick<UpdateItemCommandOutput, never>>;

type DeleteSender = (
  command: DeleteItemCommand,
) => Promise<Pick<DeleteItemCommandOutput, never>>;

type Dependencies = {
  tableName: string;
  put: PutSender;
  update: UpdateSender;
  delete: DeleteSender;
  now?: () => Date;
  randomId?: () => string;
};

function requireConfigured(dependencies: Dependencies) {
  if (
    typeof dependencies.tableName !== 'string' ||
    !dependencies.tableName.trim() ||
    typeof dependencies.put !== 'function' ||
    typeof dependencies.update !== 'function' ||
    typeof dependencies.delete !== 'function'
  ) {
    throw new Error('Invalid Vital writer configuration');
  }
}

function requireId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200
  ) {
    throw new Error('Invalid id');
  }

  return value;
}

function requireRecordedAt(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !ISO_DATETIME.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error('Invalid recordedAt');
  }

  return value;
}

function finiteNonNegative(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new Error(`Invalid ${field}`);
  }

  return value;
}

function optionalFiniteNonNegative(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  return finiteNonNegative(value, field);
}

function integerNonNegative(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`Invalid ${field}`);
  }

  return value;
}

function optionalIntegerNonNegative(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  return integerNonNegative(value, field);
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;

  if (
    typeof value !== 'string' ||
    value.length > maxLength
  ) {
    throw new Error(`Invalid ${field}`);
  }

  return value;
}

function nowIso(dependencies: Dependencies): string {
  const d = dependencies.now?.() ?? new Date();

  if (!Number.isFinite(d.getTime())) {
    throw new Error('Invalid clock');
  }

  return d.toISOString();
}

function n(value: number): AttributeValue {
  return { N: String(value) };
}

export async function createVital(
  input: CreateVitalInput,
  dependencies: Dependencies,
): Promise<VitalWriteResult> {
  requireConfigured(dependencies);

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );

  const recordedAt = requireRecordedAt(input.recordedAt);

  const weightKg =
    optionalFiniteNonNegative(input.weightKg, 'weightKg');

  const systolic =
    optionalIntegerNonNegative(input.systolic, 'systolic');

  const diastolic =
    optionalIntegerNonNegative(input.diastolic, 'diastolic');

  const notes =
    optionalString(input.notes, 'notes', 2000);

  const id = dependencies.randomId?.() ?? randomUUID();
  requireId(id);

  const timestamp = nowIso(dependencies);

  const item: Record<string, AttributeValue> = {
    id: { S: id },
    owner: { S: owner },
    recordedAt: { S: recordedAt },
    createdAt: { S: timestamp },
    updatedAt: { S: timestamp },
  };

  if (weightKg !== undefined) item.weightKg = n(weightKg);
  if (systolic !== undefined) item.systolic = n(systolic);
  if (diastolic !== undefined) item.diastolic = n(diastolic);
  if (notes !== undefined) item.notes = { S: notes };

  await dependencies.put(
    new PutItemCommand({
      TableName: dependencies.tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#id)',
      ExpressionAttributeNames: {
        '#id': 'id',
      },
    }),
  );

  return { id };
}

export async function updateVital(
  input: UpdateVitalInput,
  dependencies: Dependencies,
): Promise<VitalWriteResult> {
  requireConfigured(dependencies);

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );

  const id = requireId(input.id);

  const mutableKeys = [
    'recordedAt',
    'weightKg',
    'systolic',
    'diastolic',
    'notes',
  ] as const;

  const supplied = mutableKeys.filter(
    (key) => Object.prototype.hasOwnProperty.call(input, key),
  );

  if (supplied.length === 0) {
    throw new Error('No fields to update');
  }

  const names: Record<string, string> = {
    '#owner': 'owner',
    '#updatedAt': 'updatedAt',
  };

  const values: Record<string, AttributeValue> = {
    ':owner': { S: owner },
    ':updatedAt': { S: nowIso(dependencies) },
  };

  const sets = ['#updatedAt = :updatedAt'];
  const removes: string[] = [];

  for (const key of supplied) {
    const nameToken = `#${key}`;
    const valueToken = `:${key}`;

    names[nameToken] = key;

    const raw = input[key];

    if (raw === null) {
      if (key === 'recordedAt') {
        throw new Error('Invalid recordedAt');
      }

      removes.push(nameToken);
      continue;
    }

    switch (key) {
      case 'recordedAt':
        values[valueToken] = {
          S: requireRecordedAt(raw),
        };
        break;

      case 'weightKg':
        values[valueToken] = n(
          finiteNonNegative(raw, key),
        );
        break;

      case 'systolic':
      case 'diastolic':
        values[valueToken] = n(
          integerNonNegative(raw, key),
        );
        break;

      case 'notes':
        values[valueToken] = {
          S: optionalString(raw, key, 2000)!,
        };
        break;
    }

    sets.push(`${nameToken} = ${valueToken}`);
  }

  const updateExpression = [
    `SET ${sets.join(', ')}`,
    removes.length
      ? `REMOVE ${removes.join(', ')}`
      : '',
  ].filter(Boolean).join(' ');

  await dependencies.update(
    new UpdateItemCommand({
      TableName: dependencies.tableName,
      Key: {
        id: { S: id },
      },
      UpdateExpression: updateExpression,
      ConditionExpression:
        'attribute_exists(#id) AND #owner = :owner',
      ExpressionAttributeNames: {
        '#id': 'id',
        ...names,
      },
      ExpressionAttributeValues: values,
    }),
  );

  return { id };
}

export async function deleteVital(
  input: DeleteVitalInput,
  dependencies: Dependencies,
): Promise<VitalWriteResult> {
  requireConfigured(dependencies);

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );

  const id = requireId(input.id);

  await dependencies.delete(
    new DeleteItemCommand({
      TableName: dependencies.tableName,
      Key: {
        id: { S: id },
      },
      ConditionExpression:
        'attribute_exists(#id) AND #owner = :owner',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#owner': 'owner',
      },
      ExpressionAttributeValues: {
        ':owner': { S: owner },
      },
    }),
  );

  return { id };
}
