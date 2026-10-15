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
const SOURCE_VALUES = new Set(['measured', 'label', 'estimated']);

export type FoodEntrySource = 'measured' | 'label' | 'estimated';

export type CreateFoodEntryInput = {
  verifiedSubject: unknown;
  date: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  quantity?: string;
  notes?: string;
  source?: FoodEntrySource;
};

export type UpdateFoodEntryInput = {
  verifiedSubject: unknown;
  id: string;
  date?: string;
  name?: string;
  calories?: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  quantity?: string | null;
  notes?: string | null;
  source?: FoodEntrySource | null;
};

export type DeleteFoodEntryInput = {
  verifiedSubject: unknown;
  id: string;
};

export type FoodEntryWriteResult = {
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
    throw new Error('Invalid FoodEntry writer configuration');
  }
}

function parseIsoDate(value: unknown): string {
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

function requireName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200
  ) {
    throw new Error('Invalid name');
  }
  return value.trim();
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`Invalid ${field}`);
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

function optionalSource(
  value: unknown,
): FoodEntrySource | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !SOURCE_VALUES.has(value)) {
    throw new Error('Invalid source');
  }
  return value as FoodEntrySource;
}

function nowIso(dependencies: Dependencies): string {
  const d = dependencies.now?.() ?? new Date();
  const value = d.toISOString();

  if (!Number.isFinite(d.getTime())) {
    throw new Error('Invalid clock');
  }

  return value;
}

function n(value: number): AttributeValue {
  return { N: String(value) };
}

export async function createFoodEntry(
  input: CreateFoodEntryInput,
  dependencies: Dependencies,
): Promise<FoodEntryWriteResult> {
  requireConfigured(dependencies);

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );
  const date = parseIsoDate(input.date);
  const name = requireName(input.name);
  const calories = finiteNonNegative(input.calories, 'calories');

  const protein = optionalFiniteNonNegative(input.protein, 'protein');
  const carbs = optionalFiniteNonNegative(input.carbs, 'carbs');
  const fat = optionalFiniteNonNegative(input.fat, 'fat');
  const fiber = optionalFiniteNonNegative(input.fiber, 'fiber');

  const quantity = optionalString(input.quantity, 'quantity', 200);
  const notes = optionalString(input.notes, 'notes', 2000);
  const source = optionalSource(input.source);

  const id = dependencies.randomId?.() ?? randomUUID();
  requireId(id);

  const timestamp = nowIso(dependencies);

  const item: Record<string, AttributeValue> = {
    id: { S: id },
    owner: { S: owner },
    date: { S: date },
    name: { S: name },
    calories: n(calories),
    createdAt: { S: timestamp },
    updatedAt: { S: timestamp },
  };

  if (protein !== undefined) item.protein = n(protein);
  if (carbs !== undefined) item.carbs = n(carbs);
  if (fat !== undefined) item.fat = n(fat);
  if (fiber !== undefined) item.fiber = n(fiber);
  if (quantity !== undefined) item.quantity = { S: quantity };
  if (notes !== undefined) item.notes = { S: notes };
  if (source !== undefined) item.source = { S: source };

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

export async function updateFoodEntry(
  input: UpdateFoodEntryInput,
  dependencies: Dependencies,
): Promise<FoodEntryWriteResult> {
  requireConfigured(dependencies);

  const owner = amplifyOwnerFromVerifiedAuth0Subject(
    input.verifiedSubject,
  );
  const id = requireId(input.id);

  const mutableKeys = [
    'date',
    'name',
    'calories',
    'protein',
    'carbs',
    'fat',
    'fiber',
    'quantity',
    'notes',
    'source',
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
      if (key === 'date' || key === 'name' || key === 'calories') {
        throw new Error(`Invalid ${key}`);
      }
      removes.push(nameToken);
      continue;
    }

    switch (key) {
      case 'date':
        values[valueToken] = { S: parseIsoDate(raw) };
        break;
      case 'name':
        values[valueToken] = { S: requireName(raw) };
        break;
      case 'calories':
      case 'protein':
      case 'carbs':
      case 'fat':
      case 'fiber':
        values[valueToken] = n(
          finiteNonNegative(raw, key),
        );
        break;
      case 'quantity':
        values[valueToken] = {
          S: optionalString(raw, key, 200)!,
        };
        break;
      case 'notes':
        values[valueToken] = {
          S: optionalString(raw, key, 2000)!,
        };
        break;
      case 'source':
        values[valueToken] = {
          S: optionalSource(raw)!,
        };
        break;
    }

    sets.push(`${nameToken} = ${valueToken}`);
  }

  const updateExpression = [
    `SET ${sets.join(', ')}`,
    removes.length ? `REMOVE ${removes.join(', ')}` : '',
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

export async function deleteFoodEntry(
  input: DeleteFoodEntryInput,
  dependencies: Dependencies,
): Promise<FoodEntryWriteResult> {
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
