import { format, formatDistanceToNow, isPast, isToday, isTomorrow, parseISO, isWithinInterval, addDays } from 'date-fns';

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy');
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy h:mm a');
  } catch {
    return dateStr;
  }
}

export function formatRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

export function formatBirthday(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(parseISO(dateStr), 'MMMM d');
  } catch {
    return dateStr;
  }
}

export function isOverdue(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  try {
    return isPast(parseISO(dateStr)) && !isToday(parseISO(dateStr));
  } catch {
    return false;
  }
}

export function isDueToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  try {
    return isToday(parseISO(dateStr));
  } catch {
    return false;
  }
}

export function isDueTomorrow(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  try {
    return isTomorrow(parseISO(dateStr));
  } catch {
    return false;
  }
}

export function isUpcomingInDays(dateStr: string | null | undefined, days: number): boolean {
  if (!dateStr) return false;
  try {
    const date = parseISO(dateStr);
    const now = new Date();
    return isWithinInterval(date, { start: now, end: addDays(now, days) });
  } catch {
    return false;
  }
}

export function interactionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    meeting: 'Meeting',
    call: 'Call',
    message: 'Message',
    email: 'Email',
    other: 'Other',
  };
  return labels[type] ?? type;
}

export function sentimentLabel(sentiment: string | null | undefined): string {
  if (!sentiment) return '—';
  const labels: Record<string, string> = {
    positive: 'Positive',
    neutral: 'Neutral',
    negative: 'Negative',
  };
  return labels[sentiment] ?? sentiment;
}

export function relationshipTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    friend: 'Friend',
    family: 'Family',
    colleague: 'Colleague',
    acquaintance: 'Acquaintance',
    other: 'Other',
  };
  return labels[type] ?? type;
}

export function reminderStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pending',
    done: 'Done',
    snoozed: 'Snoozed',
    dismissed: 'Dismissed',
  };
  return labels[status] ?? status;
}
