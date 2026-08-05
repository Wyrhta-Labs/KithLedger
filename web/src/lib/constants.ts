/**
 * Server-side cap on `limit` for every list endpoint (see the `.max(100)` in
 * src/validators/*.ts). Requesting more returns 400, so pickers that want "all"
 * rows must ask for exactly this. Above this many people the pickers truncate
 * silently — the fix is server-side search in the picker, not a higher cap.
 */
export const MAX_LIST_LIMIT = 100;

export const QUERY_KEYS = {
  people: ['people'] as const,
  person: (id: string) => ['people', id] as const,
  personGraph: (id: string) => ['people', id, 'graph'] as const,
  interactions: ['interactions'] as const,
  interaction: (id: string) => ['interactions', id] as const,
  reminders: ['reminders'] as const,
  reminder: (id: string) => ['reminders', id] as const,
  relationships: ['relationships'] as const,
  relationship: (id: string) => ['relationships', id] as const,
  apiKeys: ['apiKeys'] as const,
} as const;

export const INTERACTION_TYPES = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'call', label: 'Call' },
  { value: 'message', label: 'Message' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
] as const;

// Must stay in sync with CHANNELS in src/validators/interactions.ts — the
// server rejects any other value.
export const CHANNEL_OPTIONS = [
  { value: 'in-person', label: 'In person' },
  { value: 'phone', label: 'Phone' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'video', label: 'Video' },
  { value: 'social', label: 'Social' },
] as const;

export const SENTIMENT_OPTIONS = [
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
] as const;

export const RELATIONSHIP_TYPES = [
  { value: 'friend', label: 'Friend' },
  { value: 'family', label: 'Family' },
  { value: 'colleague', label: 'Colleague' },
  { value: 'acquaintance', label: 'Acquaintance' },
  { value: 'other', label: 'Other' },
] as const;

export const REMINDER_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'done', label: 'Done' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'dismissed', label: 'Dismissed' },
] as const;

export const RECURRENCE_OPTIONS = [
  { value: 'P1D', label: 'Daily' },
  { value: 'P1W', label: 'Weekly' },
  { value: 'P2W', label: 'Bi-weekly' },
  { value: 'P1M', label: 'Monthly' },
  { value: 'P3M', label: 'Quarterly' },
  { value: 'P1Y', label: 'Yearly' },
] as const;
