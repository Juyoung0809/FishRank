import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';

export async function fetchPublicDataJson(
  baseUrl: string,
  serviceKey: string,
  params: Record<string, string | number | undefined>,
): Promise<unknown> {
  const res = await fetchPublicDataRaw(baseUrl, serviceKey, params);
  const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');

  if (text.trim().startsWith('<')) {
    throw new Error(
      '공공데이터 API가 XML로 응답했습니다. type=json 파라미터를 확인하세요.',
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return res.data;
  }
}

/** KRC 저수지 API 등 XML 응답 */
export async function fetchPublicDataXml(
  baseUrl: string,
  serviceKey: string,
  params: Record<string, string | number | undefined>,
): Promise<string> {
  const res = await fetchPublicDataRaw(baseUrl, serviceKey, params);
  const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  if (!text.trim().startsWith('<')) {
    throw new Error('공공데이터 API가 XML이 아닌 응답을 반환했습니다.');
  }
  return text;
}

async function fetchPublicDataRaw(
  baseUrl: string,
  serviceKey: string,
  params: Record<string, string | number | undefined>,
) {
  const res = await axios.get(baseUrl, {
    params: {
      ...params,
      serviceKey,
    },
    timeout: 15_000,
    responseType: 'text',
    transformResponse: [(data) => data],
    validateStatus: () => true,
  });

  if (res.status === 403 || res.status === 401) {
    throw new PublicDataAuthError(
      '공공데이터 API 활용승인 대기 중이거나 인증키가 유효하지 않습니다.',
    );
  }
  if (res.status >= 400) {
    const snippet =
      typeof res.data === 'string'
        ? res.data.slice(0, 120)
        : String(res.data).slice(0, 120);
    throw new Error(`공공데이터 API HTTP ${res.status}: ${snippet}`);
  }

  const body = typeof res.data === 'string' ? res.data : '';
  if (
    body.includes('returnReasonCode') &&
    !body.includes('returnReasonCode>00<')
  ) {
    const code = body.match(/<returnReasonCode>([^<]+)</)?.[1];
    if (code && code !== '00') {
      throw new Error(`공공데이터 API 오류 코드: ${code}`);
    }
  }

  return res;
}

export class PublicDataAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicDataAuthError';
  }
}

/** KHOA 조석 API 응답 — header/body.items.item 구조 */
export function extractKhoaItems(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;

  const data = root.data;
  if (Array.isArray(data)) return data as Record<string, unknown>[];

  const body = (root.body ??
    (root.response as Record<string, unknown> | undefined)?.body) as
    | Record<string, unknown>
    | undefined;
  const items = body?.items;
  if (!items || typeof items !== 'object') return [];

  const container = items as Record<string, unknown>;
  const item = container.item;
  if (!item) return [];
  if (Array.isArray(item)) return item as Record<string, unknown>[];
  return [item as Record<string, unknown>];
}

/** KRC XML — <item><fac_code>...</fac_code></item> */
export function parseKrcXmlItems(xml: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const block of xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? []) {
    const row: Record<string, unknown> = {};
    for (const m of block.matchAll(/<([a-zA-Z0-9_]+)>([^<]*)<\/\1>/g)) {
      row[m[1]] = m[2].trim();
    }
    if (Object.keys(row).length > 0) items.push(row);
  }
  return items;
}

/** KRC 저수지 API — XML 문자열 또는 JSON */
export function extractReservoirRows(
  payload: unknown,
): Record<string, unknown>[] {
  if (typeof payload === 'string') {
    return parseKrcXmlItems(payload);
  }
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;

  const response = root.response as Record<string, unknown> | undefined;
  if (response) {
    const body = response.body as Record<string, unknown> | undefined;
    if (body) {
      if (body.item) {
        const item = body.item;
        if (Array.isArray(item)) return item as Record<string, unknown>[];
        if (item && typeof item === 'object')
          return [item as Record<string, unknown>];
      }
      const items = body.items;
      if (items && typeof items === 'object') {
        const item = (items as Record<string, unknown>).item;
        if (Array.isArray(item)) return item as Record<string, unknown>[];
        if (item && typeof item === 'object')
          return [item as Record<string, unknown>];
      }
    }
  }

  const item = root.item;
  if (Array.isArray(item)) return item as Record<string, unknown>[];
  if (item && typeof item === 'object')
    return [item as Record<string, unknown>];

  return [];
}

export function pickRecordField(
  item: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = item[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text && text !== 'null') return text;
  }
  return null;
}

/** 공공데이터 인증 오류(미승인·키 오류)는 503 으로 바꿔 알리고, 그 밖의 오류는 그대로 던진다. */
export async function withPublicDataAuth<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PublicDataAuthError)
      throw new ServiceUnavailableException(err.message);
    throw err;
  }
}
