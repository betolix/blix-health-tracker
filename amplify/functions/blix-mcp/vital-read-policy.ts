import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export const VITAL_READ_INDEX_NAME = 'byOwnerAndRecordedAt';

export function vitalReadPolicy(tableArn: string): PolicyStatement {
  return new PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [
      `${tableArn}/index/${VITAL_READ_INDEX_NAME}`,
    ],
  });
}
