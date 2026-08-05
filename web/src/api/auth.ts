import { apiPost, apiGet, apiDelete } from './client';
import type { SingleResponse, ListResponse, AuthToken, ApiKey, ApiKeyCreated } from '../lib/types';

export function login(password: string): Promise<SingleResponse<AuthToken>> {
  return apiPost('/auth/token', { password });
}

export function listApiKeys(): Promise<ListResponse<ApiKey>> {
  return apiGet('/auth/keys');
}

export function createApiKey(name: string): Promise<SingleResponse<ApiKeyCreated>> {
  return apiPost('/auth/keys', { name });
}

export function revokeApiKey(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/auth/keys/${id}`);
}
