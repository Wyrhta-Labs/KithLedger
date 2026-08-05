const BASE_URL = '/api/v1';

// CSRF protection: using the Authorization request header (not cookies) for
// authentication inherently mitigates CSRF — cross-origin requests cannot set
// custom headers without a preflight that the server's CORS policy would block.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  return localStorage.getItem('kith_jwt');
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch {
    // fetch only rejects on transport failure (API down, dev proxy refused,
    // offline) — never on a non-2xx status. Surface that as such.
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the API — is the server running?');
  }

  // A 401 from the login endpoint means "wrong password", not "session
  // expired" — redirecting there reloaded the login page and wiped the error
  // message the form had just set, so a wrong password looked like nothing
  // happened. Let the caller handle it.
  const isLoginRequest = path.startsWith('/auth/token');

  if (res.status === 401 && !isLoginRequest) {
    localStorage.removeItem('kith_jwt');
    window.location.href = '/login';
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired');
  }

  // Not every response is JSON: a 204, a rate-limit body, or a proxy/gateway
  // error page would otherwise throw an opaque SyntaxError here.
  const raw = await res.text();
  let json: any = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      if (!res.ok) throw new ApiError(res.status, 'UNKNOWN', `Request failed (HTTP ${res.status})`);
      throw new ApiError(res.status, 'BAD_RESPONSE', 'Server returned a malformed response');
    }
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? 'UNKNOWN',
      json?.error?.message ?? `Request failed (HTTP ${res.status})`,
    );
  }

  return json as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'DELETE' });
}
