// These types are manually duplicated from the backend Drizzle schema.
// Future options to eliminate duplication: extract to a shared npm package,
// or generate from an OpenAPI spec (e.g. openapi-typescript).

export interface Person {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  tags: string[];
  notes: string | null;
  avatarUrl: string | null;
}

export interface Interaction {
  id: string;
  createdAt: string;
  updatedAt: string;
  personId: string;
  occurredAt: string;
  type: 'meeting' | 'call' | 'message' | 'email' | 'other';
  channel: InteractionChannel | null;
  notes: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
}

/** Mirrors CHANNELS in src/validators/interactions.ts — the server enforces it. */
export type InteractionChannel = 'in-person' | 'phone' | 'sms' | 'email' | 'video' | 'social';

export interface Reminder {
  id: string;
  createdAt: string;
  updatedAt: string;
  personId: string | null;
  dueAt: string;
  title: string;
  notes: string | null;
  status: 'pending' | 'done' | 'snoozed' | 'dismissed';
  snoozedUntil: string | null;
  recurrence: string | null;
}

export interface Relationship {
  id: string;
  createdAt: string;
  updatedAt: string;
  fromPersonId: string;
  toPersonId: string;
  type: 'friend' | 'family' | 'colleague' | 'acquaintance' | 'other';
  label: string | null;
  isMutual: boolean;
  notes: string | null;
}

// api_keys has no expiry, is_active or scopes column: keys never expire, and
// revoking deletes the row (so every listed key is by definition active).
// Do not re-add those fields without a migration behind them.
export interface ApiKey {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  name: string;
  keyPrefix: string;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: string;
}

export interface AuthToken {
  token: string;
  expires_in: number;
}

export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface ListResponse<T> {
  data: T[];
  meta: ListMeta;
}

export interface SingleResponse<T> {
  data: T;
}

export interface GraphNode {
  id: string;
  name: string;
  depth: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  isMutual: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphResponse {
  data: GraphData;
  meta: { root_person_id: string; depth: number };
}
