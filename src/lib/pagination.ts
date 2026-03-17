const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface Pagination {
  limit: number;
  offset: number;
}

export function parsePagination(query: Record<string, string | undefined>): Pagination {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query['limit'] ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, parseInt(query['offset'] ?? '0', 10) || 0);
  return { limit, offset };
}
