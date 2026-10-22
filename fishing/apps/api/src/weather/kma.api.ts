import { ServiceUnavailableException } from '@nestjs/common';
import type { KmaItem } from './kma-parser';

const KMA_BASE =
  'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0';
export const KMA_FETCH_TIMEOUT_MS = 6_000;

export type KmaEndpoint =
  | 'getUltraSrtNcst'
  | 'getUltraSrtFcst'
  | 'getVilageFcst';

export type KmaGridParams = {
  baseDate: string;
  baseTime: string;
  nx: number;
  ny: number;
};

/** 기상청 API허브 동네예보 호출. 실패는 503 으로 알린다. */
export async function fetchKmaItems(
  endpoint: KmaEndpoint,
  serviceKey: string,
  params: KmaGridParams,
): Promise<KmaItem[]> {
  const query = new URLSearchParams({
    pageNo: '1',
    numOfRows: '1000',
    dataType: 'JSON',
    base_date: params.baseDate,
    base_time: params.baseTime,
    nx: String(params.nx),
    ny: String(params.ny),
  });

  const url = `${KMA_BASE}/${endpoint}?authKey=${serviceKey}&${query.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KMA_FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ServiceUnavailableException(
      aborted
        ? `기상청 API 응답 시간 초과 (${endpoint}, ${KMA_FETCH_TIMEOUT_MS}ms)`
        : `기상청 API 연결 실패 (${endpoint})`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg =
      data?.result?.message ??
      data?.response?.header?.resultMsg ??
      `HTTP ${res.status}`;
    throw new ServiceUnavailableException(
      `기상청 API 호출 실패 (${endpoint}): ${msg}`,
    );
  }

  if (data?.response?.header?.resultCode !== '00') {
    const msg = data?.response?.header?.resultMsg ?? '알 수 없는 오류';
    throw new ServiceUnavailableException(`기상청 API 오류: ${msg}`);
  }

  return data?.response?.body?.items?.item ?? [];
}

/** 예보는 활용신청 전이면 실패하므로 빈 목록으로 대신한다. */
export function fetchKmaItemsOptional(
  endpoint: KmaEndpoint,
  serviceKey: string,
  params: KmaGridParams,
): Promise<KmaItem[]> {
  return fetchKmaItems(endpoint, serviceKey, params).catch(() => []);
}
