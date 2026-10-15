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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type CreateDailyTargetInput = {
  verifiedSubject: unknown;
  date: string;
  calories: number;
  protein: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  targetWeightKg?: number;
};

export type UpdateDailyTargetInput = {
  verifiedSubject: unknown;
  id: string;
  date?: string;
  calories?: number;
  protein?: number;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  targetWeightKg?: number | null;
};

export type DeleteDailyTargetInput = {
  verifiedSubject: unknown;
  id: string;
};

export type DailyTargetWriteResult = {
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
    throw new Error('Invalid DailyTarget writer configuration');
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

function requireDate(value: unknown): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new Error('Invalid date');
  }

  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('Invalid date');
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

function optionalFiniteNonNegative(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  return finiteNonNegative(value, field);
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

export async function createDailyTarget(
  input: CreateDailyTargetInput,
  dependencies: Dependencies,
): Promise<DailyTargetWriteResult> {
  requireConfigured(dependencies);

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );

  const date = requireDate(input.date);
  const calories = integerNonNegative(input.calories, 'calories');
  const protein = finiteNonNegative(input.protein, 'protein');

  const carbs = optionalFiniteNonNegative(input.carbs, 'carbs');
  const fat = optionalFiniteNonNegative(input.fat, 'fat');
  const fiber = optionalFiniteNonNegative(input.fiber, 'fiber');
  const targetWeightKg =
    optionalFiniteNonNegative(input.targetWeightKg, 'targetWeightKg');

  const id = dependencies.randomId?.() ?? randomUUID();
  requireId(id);

  const timestamp = nowIso(dependencies);

  const item: Record<string, AttributeValue> = {
    id: { S: id },
    owner: { S: owner },
    date: { S: date },
    calories: n(calories),
    protein: n(protein),
    createdAt: { S: timestamp },
    updatedAt: { S: timestamp },
  };

  if (carbs !== undefined) item.carbs = n(carbs);
  if (fat !== undefined) item.fat = n(fat);
  if (fiber !== undefined) item.fiber = n(fiber);
  if (targetWeightKg !== undefined) item.targetWeightKg = n(targetWeightKg);

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

export async function updateDailyTarget(
  input: UpdateDailyTargetInput,
  dependencies: Dependencies,
): Promise<DailyTargetWriteResult> {
  requireConfigured(dependencies);

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );

  const id = requireId(input.id);

  const mutableKeys = [
    'date',
    'calories',
    'protein',
    'carbs',
    'fat',
    'fiber',
    'targetWeightKg',
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
      if (
        key === 'date' ||
        key === 'calories' ||
        key === 'protein'
      ) {
        throw new Error(`Invalid ${key}`);
      }

      removes.push(nameToken);
      continue;
    }

    switch (key) {
      case 'date':
        values[valueToken] = {
          S: requireDate(raw),
        };
        break;

      case 'calories':
        values[valueToken] = n(
          integerNonNegative(raw, key),
        );
        break;

      case 'protein':
      case 'carbs':
      case 'fat':
      case 'fiber':
      case 'targetWeightKg':
        values[valueToken] = n(
          finiteNonNegative(raw, key),
        );
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

export async function deleteDailyTarget(
  input: DeleteDailyTargetInput,
  dependencies: Dependencies,
): Promise<DailyTargetWriteResult> {
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
