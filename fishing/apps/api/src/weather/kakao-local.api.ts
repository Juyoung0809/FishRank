/** 카카오 로컬 API. 키가 없거나 실패하면 빈 결과(null·[])로 대신한다. */

export type KakaoPlaceDoc = {
  id: string;
  place_name: string;
  address_name: string;
  category_name?: string;
  category_group_name?: string;
  y: string;
  x: string;
};

export type KakaoRegionDoc = {
  region_type: string;
  region_1depth_name?: string;
  region_2depth_name?: string;
};

export type KakaoKeywordOptions = {
  lat?: number;
  lng?: number;
  radiusM?: number;
  size?: number;
};

async function kakaoGet<T>(
  apiKey: string | undefined,
  path: string,
): Promise<T | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://dapi.kakao.com${path}`, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 키워드 장소 검색. 좌표를 주면 반경(1~20km) 안에서 거리순 */
export async function searchKakaoKeyword(
  apiKey: string | undefined,
  query: string,
  opts?: KakaoKeywordOptions,
): Promise<KakaoPlaceDoc[]> {
  const params = new URLSearchParams({ query, size: String(opts?.size ?? 15) });
  if (
    opts?.lat != null &&
    opts?.lng != null &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng)
  ) {
    params.set('y', String(opts.lat));
    params.set('x', String(opts.lng));
    params.set(
      'radius',
      String(Math.min(Math.max(opts.radiusM ?? 15000, 1000), 20000)),
    );
    params.set('sort', 'distance');
  }
  const data = await kakaoGet<{ documents?: KakaoPlaceDoc[] }>(
    apiKey,
    `/v2/local/search/keyword.json?${params.toString()}`,
  );
  return data?.documents ?? [];
}

/** 좌표 → 행정동(H) 우선 행정구역 */
export async function kakaoCoordToRegion(
  apiKey: string | undefined,
  lat: number,
  lng: number,
): Promise<KakaoRegionDoc | null> {
  const data = await kakaoGet<{ documents?: KakaoRegionDoc[] }>(
    apiKey,
    `/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`,
  );
  return (
    data?.documents?.find((d) => d.region_type === 'H') ??
    data?.documents?.[0] ??
    null
  );
}
