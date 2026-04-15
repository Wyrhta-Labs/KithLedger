import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { ListResponse, SingleResponse, Relationship } from '../lib/types';

export interface ListRelationshipsParams {
  person_id?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export interface CreateRelationshipInput {
  fromPersonId: string;
  toPersonId: string;
  type: string;
  label?: string;
  isMutual?: boolean;
  notes?: string;
}

export interface UpdateRelationshipInput {
  type?: string;
  label?: string | null;
  isMutual?: boolean;
  notes?: string | null;
}

function toQueryString(params: object): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      qs.set(k, String(v));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function listRelationships(params: ListRelationshipsParams = {}): Promise<ListResponse<Relationship>> {
  return apiGet(`/relationships${toQueryString(params)}`);
}

export function getRelationship(id: string): Promise<SingleResponse<Relationship>> {
  return apiGet(`/relationships/${id}`);
}

export function createRelationship(input: CreateRelationshipInput): Promise<SingleResponse<Relationship>> {
  return apiPost('/relationships', input);
}

export function updateRelationship(id: string, input: UpdateRelationshipInput): Promise<SingleResponse<Relationship>> {
  return apiPatch(`/relationships/${id}`, input);
}

export function deleteRelationship(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/relationships/${id}`);
}
