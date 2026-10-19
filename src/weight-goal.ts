// Independent of DailyTarget: saving a weight goal never creates nutrition goals.
export type WeightGoal = { userId: string; targetWeightKg: number };
type Result = { data: WeightGoal | null; errors?: readonly unknown[] };
type AuthOptions = { authMode: 'userPool' };
export type WeightGoalModel = {
  get: (key: { userId: string }, options: AuthOptions) => Promise<Result>;
  create: (goal: WeightGoal, options: AuthOptions) => Promise<Result>;
  update: (goal: WeightGoal, options: AuthOptions) => Promise<Result>;
};
const auth: AuthOptions = { authMode: 'userPool' };

export function isValidTargetWeight(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function requireUser(userId: string): void {
  if (!userId.trim()) throw new Error('Authentication required');
}

function checkedGoal(result: Result, userId: string): WeightGoal | null {
  if (result.errors?.length) throw new Error('Weight goal request failed');
  if (result.data && (result.data.userId !== userId || !isValidTargetWeight(result.data.targetWeightKg))) {
    throw new Error('Invalid weight goal response');
  }
  return result.data;
}

export async function loadWeightGoal(model: WeightGoalModel, userId: string): Promise<WeightGoal | null> {
  requireUser(userId);
  return checkedGoal(await model.get({ userId }, auth), userId);
}

export async function saveWeightGoal(model: WeightGoalModel, userId: string, targetWeightKg: number): Promise<WeightGoal> {
  requireUser(userId);
  if (!isValidTargetWeight(targetWeightKg)) throw new Error('Invalid target weight');
  const goal = { userId, targetWeightKg };
  // Read the current cloud state, not an initial UI snapshot. A fixed primary
  // key prevents duplicate goals when two devices create one concurrently.
  const current = await loadWeightGoal(model, userId);
  const result = await (current ? model.update(goal, auth) : model.create(goal, auth));
  const saved = checkedGoal(result, userId);
  if (!saved) throw new Error('Weight goal was not saved');
  return saved;
}

export function weightChartBounds(values: number[], target: number | null): [number, number] {
  const all = target === null ? values : [...values, target];
  return [Math.min(...all) - 1, Math.max(...all) + 1];
}
