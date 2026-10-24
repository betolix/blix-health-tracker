// The dashboard name comes from the signed-in Cognito user, never from code.
// Accounts sign in with email only, so `name` is optional and may be unset.
export type UserAttributes = Partial<Record<string, string>>;
export type ProfileAuth = {
  fetchUserAttributes: () => Promise<UserAttributes>;
  updateUserAttributes: (input: { userAttributes: { name: string } }) =>
    Promise<Partial<Record<string, { isUpdated: boolean }>>>;
};

export const MAX_DISPLAY_NAME_LENGTH = 40;

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function isValidDisplayName(value: string): boolean {
  const name = normalizeDisplayName(value);
  return name.length > 0 && name.length <= MAX_DISPLAY_NAME_LENGTH;
}

// Prefer the saved name, then the email's local part. Null means nothing usable.
export function resolveDisplayName(attributes: UserAttributes): string | null {
  for (const candidate of [attributes.name, attributes.given_name]) {
    if (candidate && isValidDisplayName(candidate)) return normalizeDisplayName(candidate);
  }
  const local = attributes.email?.split('@')[0]?.trim();
  return local ? local.slice(0, MAX_DISPLAY_NAME_LENGTH) : null;
}

export async function loadDisplayName(auth: ProfileAuth): Promise<{ display: string | null; saved: string }> {
  const attributes = await auth.fetchUserAttributes();
  const saved = attributes.name && isValidDisplayName(attributes.name) ? normalizeDisplayName(attributes.name) : '';
  return { display: resolveDisplayName(attributes), saved };
}

export async function saveDisplayName(auth: ProfileAuth, value: string): Promise<string> {
  if (!isValidDisplayName(value)) throw new Error('Invalid display name');
  const name = normalizeDisplayName(value);
  const result = await auth.updateUserAttributes({ userAttributes: { name } });
  if (!result.name?.isUpdated) throw new Error('Display name was not saved');
  return name;
}
