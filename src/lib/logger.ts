export interface LogEvent {
  timestamp?: string;
  event: string;
  ip?: string;
  auth_type?: string;
  success?: boolean;
  request_id?: string;
  key_id?: string;
  key_name?: string;
  [key: string]: unknown;
}

export function logEvent(event: LogEvent): void {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), ...event })
  );
}

export function logError(message: string, error: unknown): void {
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(
    JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', message, stack })
  );
}
