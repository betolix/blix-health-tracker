import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({

  // One goal per Cognito subject. The primary key is also the authorization
  // owner, so clients cannot create a goal in another user's namespace.
  WeightGoal: a
    .model({
      userId: a.string().required(),
      targetWeightKg: a.float().required().validate(v => v.gt(0)),
    })
    .identifier(['userId'])
    .authorization((allow) => [
      allow.ownerDefinedIn('userId').identityClaim('sub'),
    ]),

  FoodEntry: a
    .model({
      date: a.date().required(),
      name: a.string().required(),

      calories: a.float().required(),
      protein: a.float(),
      carbs: a.float(),
      fat: a.float(),
      fiber: a.float(),

      quantity: a.string(),
      notes: a.string(),

      source: a.enum([
        'measured',
        'label',
        'estimated',
      ]),

      owner: a.string().authorization((allow) => [
        allow.owner().to(['read', 'delete']),
      ]),
    })
    .secondaryIndexes((index) => [
      index('owner')
        .sortKeys(['date'])
        .name('byOwnerAndDate')
        .projection('INCLUDE', ['name', 'calories']),
    ])
    .authorization((allow) => [
      allow.owner(),
    ]),

  Vital: a
    .model({
      recordedAt: a.datetime().required(),

      weightKg: a.float(),

      systolic: a.integer(),
      diastolic: a.integer(),

      notes: a.string(),

      owner: a.string().authorization((allow) => [
        allow.owner().to(['read', 'delete']),
      ]),
    })
    .secondaryIndexes((index) => [
      index('owner')
        .sortKeys(['recordedAt'])
        .name('byOwnerAndRecordedAt')
        .projection('INCLUDE', ['weightKg', 'systolic', 'diastolic']),
    ])
    .authorization((allow) => [
      allow.owner(),
    ]),

  DailyTarget: a
    .model({
      date: a.date().required(),

      calories: a.integer().required(),
      protein: a.float().required(),
      carbs: a.float(),
      fat: a.float(),
      fiber: a.float(),

      targetWeightKg: a.float(),

      owner: a.string().authorization((allow) => [
        allow.owner().to(['read', 'delete']),
      ]),
    })
    .secondaryIndexes((index) => [
      index('owner')
        .sortKeys(['date'])
        .name('byOwnerAndDate')
        .projection('INCLUDE', [
          'calories',
          'protein',
          'carbs',
          'fat',
          'fiber',
          'targetWeightKg',
        ]),
    ])
    .authorization((allow) => [
      allow.owner(),
    ]),

    OwnershipProbe: a
    .model({
      label: a.string().required(),

      owner: a.string().authorization((allow) => [
        allow.owner().to(['read', 'delete']),
      ]),
    })
    .authorization((allow) => [
      allow.owner(),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
