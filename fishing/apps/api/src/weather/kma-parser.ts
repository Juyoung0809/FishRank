export type KmaItem = {
  category: string;
  obsrValue?: string;
  fcstValue?: string;
  fcstDate?: string;
  fcstTime?: string;
};

export function itemsToMap(items: KmaItem[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of items) {
    map[item.category] = item.obsrValue ?? item.fcstValue ?? '';
  }
  return map;
}

export function groupFcstItems(
  items: KmaItem[],
): Record<string, Record<string, string>> {
  const grouped: Record<string, Record<string, string>> = {};
  for (const item of items) {
    if (!item.fcstDate || !item.fcstTime) continue;
    const key = `${item.fcstDate}${item.fcstTime}`;
    if (!grouped[key]) grouped[key] = {};
    grouped[key][item.category] = item.fcstValue ?? '';
  }
  return grouped;
}

/** 단기예보 TMN(최저) · TMX(최고) — 날짜별 일교차 */
export function extractDailyMinMax(
  grouped: Record<string, Record<string, string>>,
): Map<string, { min?: number; max?: number }> {
  const map = new Map<string, { min?: number; max?: number }>();
  for (const [time, values] of Object.entries(grouped)) {
    const date = time.slice(0, 8);
    if (!map.has(date)) map.set(date, {});
    const row = map.get(date)!;
    if (values.TMN != null && values.TMN !== '') {
      const n = Number(values.TMN);
      if (Number.isFinite(n)) row.min = n;
    }
    if (values.TMX != null && values.TMX !== '') {
      const n = Number(values.TMX);
      if (Number.isFinite(n)) row.max = n;
    }
  }
  return map;
}

export function parsePrecipitation(value: string | undefined): number {
  if (!value || value === '강수없음') return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function ptyToLabel(pty: number): string {
  const labels: Record<number, string> = {
    0: '없음',
    1: '비',
    2: '비/눈',
    3: '눈',
    5: '빗방울',
    6: '빗방울·눈날림',
    7: '눈날림',
  };
  return labels[pty] ?? '없음';
}

export function skyToLabel(sky: number): string {
  const labels: Record<number, string> = {
    1: '맑음',
    3: '구름많음',
    4: '흐림',
  };
  return labels[sky] ?? '맑음';
}

export function windDirectionLabel(deg: number): string {
  const dirs = [
    '북',
    '북북동',
    '북동',
    '동북동',
    '동',
    '동남동',
    '남동',
    '남남동',
    '남',
    '남남서',
    '남서',
    '서남서',
    '서',
    '서북서',
    '북서',
    '북북서',
  ];
  const idx = Math.round(deg / 22.5) % 16;
  return dirs[idx];
}

export function formatFcstTime(fcstDate: string, fcstTime: string): string {
  const month = fcstDate.slice(4, 6);
  const day = fcstDate.slice(6, 8);
  const hour = fcstTime.slice(0, 2);
  return `${month}/${day} ${hour}:00`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDateLabel(dateStr: string): string {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(4, 6));
  const d = Number(dateStr.slice(6, 8));
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d} (${weekday})`;
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
