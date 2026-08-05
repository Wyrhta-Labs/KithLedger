import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { ListResponse, SingleResponse, Person, GraphResponse } from '../lib/types';

export interface ListPeopleParams {
  q?: string;
  tags?: string;
  birthday_month?: number;
  sort?: 'name' | 'created_at' | 'updated_at' | 'birthday';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CreatePersonInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  birthday?: string | null;
  tags?: string[];
  notes?: string | null;
  avatarUrl?: string | null;
}

export interface UpdatePersonInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  birthday?: string | null;
  tags?: string[];
  notes?: string | null;
  avatarUrl?: string | null;
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

export function listPeople(params: ListPeopleParams = {}): Promise<ListResponse<Person>> {
  return apiGet(`/people${toQueryString(params)}`);
}

export function getPerson(id: string): Promise<SingleResponse<Person>> {
  return apiGet(`/people/${id}`);
}

export function createPerson(input: CreatePersonInput): Promise<SingleResponse<Person>> {
  return apiPost('/people', input);
}

export function updatePerson(id: string, input: UpdatePersonInput): Promise<SingleResponse<Person>> {
  return apiPatch(`/people/${id}`, input);
}

export function deletePerson(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/people/${id}`);
}

export function getPersonGraph(id: string, depth = 2): Promise<GraphResponse> {
  return apiGet(`/people/${id}/graph?depth=${depth}`);
}
