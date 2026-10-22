import type { NearbyWaterPlace } from './geocode.service';
import type { ReservoirCode } from './reservoir-public.client';

/** 저수지 목록 행 만들기·후보 정렬·카카오 지도 보강 (상태 없는 순수 함수) */

export type ReservoirAreaRow = {
  facCode: string;
  facName: string;
  county: string | null;
  ratePercent: number | null;
  waterLevelM: number | null;
  checkDate: string | null;
  lat: number;
  lng: number;
  geocoded: boolean;
};

/** 수위·저수율이 없는 행. 좌표가 없으면 0,0 이고 geocoded=false */
export function noLevelRow(
  base: { facCode: string; facName: string; county: string | null },
  coord?: { lat: number; lng: number },
): ReservoirAreaRow {
  return {
    facCode: base.facCode,
    facName: base.facName,
    county: base.county,
    ratePercent: null,
    waterLevelM: null,
    checkDate: null,
    lat: coord?.lat ?? 0,
    lng: coord?.lng ?? 0,
    geocoded: coord != null,
  };
}

export function stubRow(candidate: ReservoirCode): ReservoirAreaRow {
  return noLevelRow(candidate);
}

/** 이름 힌트(시·군) +10, 지역 힌트 +8, 댐·저수지·호 +3 점으로 정렬 */
export function rankCandidates(
  rows: ReservoirCode[],
  nameHint?: string,
  regionHint?: string,
): ReservoirCode[] {
  const score = (row: ReservoirCode) =>
    (nameHint && row.facName.includes(nameHint) ? 10 : 0) +
    (regionHint && row.county?.includes(regionHint) ? 8 : 0) +
    (/댐|저수지|호/.test(row.facName) ? 3 : 0);
  return rows
    .map((row) => ({ row, score: score(row) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.row);
}

/** 카카오 지도 POI로 좌표 없는 KRC 행을 채우고, 매칭 안 되면 새 마커로 추가 */
export function mergeKakaoNearby(
  rows: ReservoirAreaRow[],
  kakaoNearby: NearbyWaterPlace[],
  candidates: ReservoirCode[],
) {
  if (!kakaoNearby.length) return;

  const normalize = (s: string) =>
    s
      .replace(/\s+/g, '')
      .replace(/(저수지|저수면|저류지|유수지|배수지|댐|호수)$/g, '');
  const usedKakao = new Set<string>();

  // 1) 아직 좌표 없는 KRC 행에 이름 비슷한 카카오 POI 좌표 부여
  for (const row of rows) {
    if (row.geocoded) continue;
    const base = normalize(row.facName);
    if (base.length < 2) continue;
    const hit = kakaoNearby.find((k) => {
      if (usedKakao.has(k.id)) return false;
      const kn = normalize(k.name);
      return (
        kn.includes(base) || base.includes(kn) || k.name.includes(row.facName)
      );
    });
    if (!hit) continue;
    Object.assign(row, { lat: hit.lat, lng: hit.lng, geocoded: true });
    usedKakao.add(hit.id);
  }

  // 2) 기존 마커와 멀리 떨어진 카카오 저수지는 추가 (지도에만 있는 소규모 저수지)
  const nearExisting = (lat: number, lng: number) =>
    rows.some(
      (r) =>
        r.geocoded &&
        Math.abs(r.lat - lat) < 0.004 &&
        Math.abs(r.lng - lng) < 0.004,
    );
  const candidateNames = new Set(candidates.map((c) => normalize(c.facName)));

  for (const k of kakaoNearby) {
    if (usedKakao.has(k.id) || nearExisting(k.lat, k.lng)) continue;
    const kn = normalize(k.name);
    // 이미 KRC 목록에 이름만 있는 경우 stub를 좌표만 채운 것으로 충분
    if (
      candidateNames.has(kn) &&
      rows.some((r) => normalize(r.facName) === kn && r.geocoded)
    )
      continue;
    rows.push(
      noLevelRow(
        { facCode: k.id, facName: k.name, county: k.address || null },
        k,
      ),
    );
    usedKakao.add(k.id);
  }
}
