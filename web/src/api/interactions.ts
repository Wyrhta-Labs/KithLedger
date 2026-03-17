import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { ListResponse, SingleResponse, Interaction } from '../lib/types';

export interface ListInteractionsParams {
  person_id?: string;
  type?: string;
  sentiment?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface CreateInteractionInput {
  personId: string;
  occurredAt: string;
  type: 'meeting' | 'call' | 'message' | 'email' | 'other';
  channel?: string;
  notes?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
}

export interface UpdateInteractionInput {
  occurredAt?: string;
  type?: 'meeting' | 'call' | 'message' | 'email' | 'other';
  channel?: string | null;
  notes?: string | null;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
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

export function listInteractions(params: ListInteractionsParams = {}): Promise<ListResponse<Interaction>> {
  return apiGet(`/interactions${toQueryString(params)}`);
}

export function getInteraction(id: string): Promise<SingleResponse<Interaction>> {
  return apiGet(`/interactions/${id}`);
}

export function createInteraction(input: CreateInteractionInput): Promise<SingleResponse<Interaction>> {
  return apiPost('/interactions', input);
}

export function updateInteraction(id: string, input: UpdateInteractionInput): Promise<SingleResponse<Interaction>> {
  return apiPatch(`/interactions/${id}`, input);
}

export function deleteInteraction(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/interactions/${id}`);
}
