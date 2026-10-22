export function parsePageLimit(
  page: unknown,
  limit: unknown,
  defaultLimit = 20,
  maxLimit = 50,
): { page: number; limit: number } {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  const safePage =
    Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit >= 1
      ? Math.min(maxLimit, Math.floor(parsedLimit))
      : defaultLimit;
  return { page: safePage, limit: safeLimit };
}

export function parseLimit(
  limit: unknown,
  defaultLimit: number,
  maxLimit: number,
): number {
  return parsePageLimit(1, limit, defaultLimit, maxLimit).limit;
}

/** page/limit 을 범위 안으로 맞추고 Prisma skip/take 를 함께 돌려준다. */
export function pageWindow(page: number, limit: number, maxLimit = 50) {
  const safePage = Math.max(1, page);
  const take = Math.min(maxLimit, Math.max(1, limit));
  return { page: safePage, take, skip: (safePage - 1) * take };
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
) {
  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
