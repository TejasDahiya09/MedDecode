import { ApiError, requestAuthenticatedJson } from '../../services/api-client';

export interface AccountProfile {
  readonly id: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(`The account response contains an invalid ${field}.`, 502, 'response');
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ApiError(`The account response contains an invalid ${field}.`, 502, 'response');
  return value;
}

function timestamp(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!Number.isFinite(Date.parse(text))) throw new ApiError(`The account response contains an invalid ${field}.`, 502, 'response');
  return text;
}

export async function fetchAccountProfile(accessToken: string): Promise<AccountProfile> {
  const response = await requestAuthenticatedJson('/api/v1/users/me', accessToken);
  if (!response || typeof response !== 'object' || !('profile' in response)) {
    throw new ApiError('The account service returned an invalid response.', 502, 'response');
  }
  const profile = (response as { profile?: unknown }).profile;
  if (!profile || typeof profile !== 'object') throw new ApiError('The account service returned an invalid profile.', 502, 'response');
  const row = profile as Record<string, unknown>;
  return {
    id: requiredString(row.id, 'account identifier'),
    email: nullableString(row.email, 'email'),
    name: nullableString(row.name, 'name'),
    createdAt: timestamp(row.created_at, 'creation timestamp'),
    updatedAt: timestamp(row.updated_at, 'update timestamp'),
  };
}
