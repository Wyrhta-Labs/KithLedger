export const QUERY_KEYS = {
  people: ['people'] as const,
  person: (id: string) => ['people', id] as const,
  personGraph: (id: string, depth?: number) => ['people', id, 'graph', depth ?? 1] as const,
  interactions: ['interactions'] as const,
  interaction: (id: string) => ['interactions', id] as const,
  reminders: ['reminders'] as const,
  reminder: (id: string) => ['reminders', id] as const,
  relationships: ['relationships'] as const,
  relationship: (id: string) => ['relationships', id] as const,
  apiKeys: ['apiKeys'] as const,
  settingValues: ['settingValues'] as const,
} as const;

export const SENTIMENT_OPTIONS = [
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
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
