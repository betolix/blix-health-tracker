import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export function foodEntryWritePolicy(tableArn: string): PolicyStatement {
  return new PolicyStatement({
    actions: [
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    ],
    resources: [tableArn],
  });
}
