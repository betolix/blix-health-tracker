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
});

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
