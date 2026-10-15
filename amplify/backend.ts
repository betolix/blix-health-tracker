import { foodEntryReadPolicy } from './functions/blix-mcp/food-entry-read-policy';
import { foodEntryWritePolicy } from './functions/blix-mcp/food-entry-write-policy';
import { vitalReadPolicy } from './functions/blix-mcp/vital-read-policy';
import { vitalWritePolicy } from './functions/blix-mcp/vital-write-policy';
import { dailyTargetReadPolicy } from './functions/blix-mcp/daily-target-read-policy';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { blixMcp } from './functions/blix-mcp/resource';
import { RemovalPolicy } from 'aws-cdk-lib';
import { defineBackend } from '@aws-amplify/backend';
import {
  OAuthScope,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';

import { auth } from './auth/resource';
import { data } from './data/resource';

const backend = defineBackend({
  auth,
  data,
  blixMcp,
});

// Protect the real FoodEntry table before introducing its owner/date GSI.
const foodEntryCfnTable =
  backend.data.resources.cfnResources.amplifyDynamoDbTables['FoodEntry'];

foodEntryCfnTable.pointInTimeRecoveryEnabled = true;
foodEntryCfnTable.deletionProtectionEnabled = true;
foodEntryCfnTable.applyRemovalPolicy(RemovalPolicy.RETAIN);

// Protect Vital before exposing its owner/time index to MCP.
const vitalCfnTable =
  backend.data.resources.cfnResources.amplifyDynamoDbTables['Vital'];

vitalCfnTable.pointInTimeRecoveryEnabled = true;
vitalCfnTable.deletionProtectionEnabled = true;
vitalCfnTable.applyRemovalPolicy(RemovalPolicy.RETAIN);

// Protect DailyTarget before exposing its owner/date index to MCP.
const dailyTargetCfnTable =
  backend.data.resources.cfnResources.amplifyDynamoDbTables['DailyTarget'];

dailyTargetCfnTable.pointInTimeRecoveryEnabled = true;
dailyTargetCfnTable.deletionProtectionEnabled = true;
dailyTargetCfnTable.applyRemovalPolicy(RemovalPolicy.RETAIN);

const foodEntryTable = backend.data.resources.tables['FoodEntry'];

backend.blixMcp.resources.lambda.addToRolePolicy(
  foodEntryReadPolicy(foodEntryTable.tableArn),
);

backend.blixMcp.resources.lambda.addToRolePolicy(
  foodEntryWritePolicy(foodEntryTable.tableArn),
);

backend.blixMcp.resources.lambda.addEnvironment(
  'FOOD_ENTRY_TABLE_NAME',
  foodEntryTable.tableName,
);

const vitalTable = backend.data.resources.tables['Vital'];

backend.blixMcp.resources.lambda.addToRolePolicy(
  vitalReadPolicy(vitalTable.tableArn),
);

backend.blixMcp.resources.lambda.addToRolePolicy(
  vitalWritePolicy(vitalTable.tableArn),
);

backend.blixMcp.resources.lambda.addEnvironment(
  'VITAL_TABLE_NAME',
  vitalTable.tableName,
);

const dailyTargetTable = backend.data.resources.tables['DailyTarget'];

backend.blixMcp.resources.lambda.addToRolePolicy(
  dailyTargetReadPolicy(dailyTargetTable.tableArn),
);

backend.blixMcp.resources.lambda.addEnvironment(
  'DAILY_TARGET_TABLE_NAME',
  dailyTargetTable.tableName,
);

backend.blixMcp.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
});

// Synthetic ownership probe: Scan is restricted to OwnershipProbe.
const ownershipProbeTable = backend.data.resources.tables['OwnershipProbe'];
backend.blixMcp.resources.lambda.addToRolePolicy(new PolicyStatement({
  actions: ['dynamodb:Scan'],
  resources: [ownershipProbeTable.tableArn],
}));
backend.blixMcp.resources.lambda.addEnvironment(
  'OWNERSHIP_PROBE_TABLE_NAME',
  ownershipProbeTable.tableName,
);

// ISOLATED SYNTHETIC DATASET. Not an Amplify Data model and not health data.
// Query is the only permission the MCP Lambda gets on this table/index.
const syntheticFoodTable = new Table(
  backend.createStack('BlixSyntheticFoodProbe'),
  'SyntheticFoodEntry',
  {
    partitionKey: { name: 'id', type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    removalPolicy: RemovalPolicy.RETAIN,
  },
);
syntheticFoodTable.addGlobalSecondaryIndex({
  indexName: 'byIdentityKey',
  partitionKey: { name: 'identityKey', type: AttributeType.STRING },
  projectionType: ProjectionType.INCLUDE,
  nonKeyAttributes: ['date', 'name', 'calories'],
});
backend.blixMcp.resources.lambda.addToRolePolicy(new PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [
    `${syntheticFoodTable.tableArn}/index/byIdentityKey`,
  ],
}));
backend.blixMcp.resources.lambda.addEnvironment(
  'SYNTHETIC_FOOD_TABLE_NAME', syntheticFoodTable.tableName,
);
backend.blixMcp.resources.lambda.addEnvironment(
  'SYNTHETIC_FOOD_INDEX_NAME', 'byIdentityKey',
);

// Protect the production Cognito user pool from accidental deletion.
backend.auth.resources.cfnResources.cfnUserPool.deletionProtection = 'ACTIVE';
backend.auth.resources.userPool.applyRemovalPolicy(RemovalPolicy.RETAIN);

// Cognito hosted login for Auth0 federation.
backend.auth.resources.userPool.addDomain('BlixOAuthDomain', {
  cognitoDomain: {
    domainPrefix: 'blix-mcp-699346725226',
  },
});

// Dedicated OAuth client for Auth0.
// Does not modify the existing Blix web application client.
backend.auth.resources.userPool.addClient(
  'BlixAuth0FederationClient',
  {
    userPoolClientName: 'blix-auth0-federation',
    generateSecret: true,

    supportedIdentityProviders: [
      UserPoolClientIdentityProvider.COGNITO,
    ],

    oAuth: {
      flows: {
        authorizationCodeGrant: true,
      },

      scopes: [
        OAuthScope.OPENID,
        OAuthScope.EMAIL,
        OAuthScope.PROFILE,
      ],

      callbackUrls: [
        'https://dev-0nvmmicnskv1kx50.us.auth0.com/login/callback',
      ],
    },
  }
);
