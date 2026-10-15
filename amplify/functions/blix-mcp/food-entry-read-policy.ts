import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export const FOOD_ENTRY_READ_INDEX_NAME = 'byOwnerAndDate';

export function foodEntryReadPolicy(tableArn: string): PolicyStatement {
  return new PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [
      `${tableArn}/index/${FOOD_ENTRY_READ_INDEX_NAME}`,
    ],
  });
}
