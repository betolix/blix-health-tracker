import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export const DAILY_TARGET_READ_INDEX_NAME = 'byOwnerAndDate';

export function dailyTargetReadPolicy(tableArn: string): PolicyStatement {
  return new PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [
      `${tableArn}/index/${DAILY_TARGET_READ_INDEX_NAME}`,
    ],
  });
}
