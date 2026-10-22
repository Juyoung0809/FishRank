import { haversineKm } from '../common/geo.util';
import type { FishingBanZoneDto } from './fishing-ban.service';

/** 해양수산부 수산자원보호구역 WFS(GML) → 구역 목록. 좌표가 투영(EPSG:5179)이면 위경도로 근사 변환한다. */
export function parseMofWfs(xml: string): FishingBanZoneDto[] {
  const zones: FishingBanZoneDto[] = [];
  const members =
    xml.match(/<(?:\w+:)?member[\s>][\s\S]*?<\/(?:\w+:)?member>/gi) ??
    xml.match(
      /<(?:\w+:)?featureMember[\s>][\s\S]*?<\/(?:\w+:)?featureMember>/gi,
    ) ??
    [];

  let i = 0;
  for (const block of members) {
    const name =
      pickXml(block, 'fshrsrc_pzn_nm') ??
      pickXml(block, 'fshrsr_pzn_nm') ??
      pickXml(block, 'name') ??
      `수산자원보호구역 ${i + 1}`;
    const code =
      pickXml(block, 'fshrsrc_pzn_cd') ??
      pickXml(block, 'fshrsr_pzn_cd') ??
      `mof-${i}`;
    const coordsText =
      block.match(
        /<(?:\w+:)?posList[^>]*>([\s\S]*?)<\/(?:\w+:)?posList>/i,
      )?.[1] ??
      block.match(
        /<(?:\w+:)?coordinates[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/i,
      )?.[1] ??
      '';

    const nums = coordsText
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (nums.length < 2) continue;

    const pairs: Array<[number, number]> = [];
    for (let k = 0; k + 1 < nums.length; k += 2) {
      pairs.push([nums[k], nums[k + 1]]);
    }
    if (!pairs.length) continue;

    const sample = pairs[0];
    const isProjected = Math.abs(sample[0]) > 180 || Math.abs(sample[1]) > 90;
    const wgsPairs = isProjected
      ? pairs.map(([x, y]) => epsg5179ToWgs84(x, y))
      : pairs.map(([a, b]) => {
          if (Math.abs(a) <= 90 && Math.abs(b) > 90) return { lat: a, lng: b };
          return { lat: b, lng: a };
        });

    const lat = wgsPairs.reduce((s, p) => s + p.lat, 0) / wgsPairs.length;
    const lng = wgsPairs.reduce((s, p) => s + p.lng, 0) / wgsPairs.length;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    zones.push({
      id: `mof-${code}`,
      name,
      lat,
      lng,
      radiusM: estimateRadiusM(wgsPairs),
      kind: 'protect',
      reason: '수산자원보호구역 (해양수산부)',
      source: '해양수산부 수산자원보호구역 WFS (data.go.kr 15097317)',
      path: wgsPairs.length >= 3 ? wgsPairs : undefined,
    });
    i += 1;
  }
  return zones;
}

function pickXml(block: string, tag: string): string | null {
  const re = new RegExp(
    `<(?:\\w+:)?${tag}[^>]*>([^<]*)</(?:\\w+:)?${tag}>`,
    'i',
  );
  const m = block.match(re);
  return m?.[1]?.trim() || null;
}

function estimateRadiusM(path: Array<{ lat: number; lng: number }>): number {
  if (path.length < 2) return 3000;
  let max = 0;
  const cLat = path.reduce((s, p) => s + p.lat, 0) / path.length;
  const cLng = path.reduce((s, p) => s + p.lng, 0) / path.length;
  for (const p of path) {
    max = Math.max(max, haversineKm(cLat, cLng, p.lat, p.lng) * 1000);
  }
  return Math.min(Math.max(Math.round(max), 800), 25000);
}

function epsg5179ToWgs84(x: number, y: number): { lat: number; lng: number } {
  const lng = (x - 1_000_000) / 88_000 + 127.5;
  const lat = (y - 2_000_000) / 110_000 + 38.0;
  return { lat, lng };
}
