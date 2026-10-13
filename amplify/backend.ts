import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
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

backend.blixMcp.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
});

// Synthetic-only probe: this Lambda gets Scan on OwnershipProbe, and no
// permissions to the FoodEntry, Vital, or DailyTarget DynamoDB tables.
const ownershipProbeTable = backend.data.resources.tables['OwnershipProbe'];
backend.blixMcp.resources.lambda.addToRolePolicy(new PolicyStatement({
  actions: ['dynamodb:Scan'],
  resources: [ownershipProbeTable.tableArn],
}));
backend.blixMcp.resources.lambda.addEnvironment(
  'OWNERSHIP_PROBE_TABLE_NAME',
  ownershipProbeTable.tableName,
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
