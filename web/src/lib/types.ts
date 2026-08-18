// These types are manually duplicated from the backend Drizzle schema.
// Future options to eliminate duplication: extract to a shared npm package,
// or generate from an OpenAPI spec (e.g. openapi-typescript).

/**
 * ADR 0004 §1 — per-member visibility of a node or edge. `household` is an
 * explicit state, NOT "shared with every current member": a member added
 * later sees `household` items automatically, while a `shared` set does not
 * grow to include them.
 */
export type Visibility = 'private' | 'shared' | 'household';

/**
 * Owner + visibility, carried independently by every node AND every edge
 * (ADR 0004 §1). Present on the wire from migration 0004 onward; enforcement
 * (filtering by the caller's scope) lands with task B6, so until then these
 * fields are informational and the API returns every row regardless.
 *
 * `ownerId` is nullable only during the B5..B6 window — the write path cannot
 * stamp an owner until it carries a principal. Treat null as "unowned", not
 * as "yours".
 */
export interface Owned {
  ownerId: string | null;
  visibility: Visibility;
}

export interface Person extends Owned {
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

export interface Interaction extends Owned {
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

export interface Reminder extends Owned {
  id: string;
  createdAt: string;
  updatedAt: string;
  // Not nullable in the database (person_id is NOT NULL); typed as such only
  // because older client code assumed it could be absent.
  personId: string | null;
  dueAt: string;
  title: string;
  notes: string | null;
  status: 'pending' | 'done' | 'snoozed' | 'dismissed';
  snoozedUntil: string | null;
  recurrence: string | null;
  kind: 'generic' | 'birthday';
  /** Days before the birthday; null unless kind is 'birthday'. */
  leadDays: number | null;
}

export interface Relationship extends Owned {
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
