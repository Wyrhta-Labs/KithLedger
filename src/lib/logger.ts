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

const SENSITIVE_PATTERNS = [
  /password["']?\s*[:=]\s*["'][^"']{0,100}["']/gi,
  /bearer\s+[a-zA-Z0-9\-._~+\/]+=*/gi,
  /kl_[a-f0-9]{64}/gi,
  /eyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g,
];

function sanitize(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function logEvent(event: LogEvent): void {
  console.log(
    sanitize(JSON.stringify({ timestamp: new Date().toISOString(), ...event }))
  );
}

export function logError(message: string, error: unknown): void {
  const stack = error instanceof Error ? sanitize(error.stack || '') : undefined;
  console.error(
    JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', message: sanitize(message), stack })
  );
}
