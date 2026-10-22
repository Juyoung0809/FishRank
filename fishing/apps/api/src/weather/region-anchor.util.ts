import {
  formatActivityRegion,
  formatActivityRegionLabel,
  KOREAN_PROVINCES,
} from '../common/constants/korean-regions';
import type { KakaoRegionDoc } from './kakao-local.api';

/** 좌표가 속한 활동 지역(시·도 + 시·군·구) */
export type RegionAnchorResult = {
  province: string;
  district: string;
  activityRegion: string;
  label: string;
  lat: number;
  lng: number;
};

function anchor(
  province: string,
  district: string,
  lat: number,
  lng: number,
): RegionAnchorResult {
  const activityRegion = district
    ? formatActivityRegion(province, district)
    : province;
  return {
    province,
    district,
    activityRegion,
    label: formatActivityRegionLabel(activityRegion),
    lat,
    lng,
  };
}

/** 지역을 알 수 없을 때 기본값 (서울 강남) */
export function defaultRegionAnchor(): RegionAnchorResult {
  return anchor('서울', '강남', 37.5172, 127.0473);
}

/**
 * 카카오 행정구역 결과를 앱의 지역 목록에 맞춘다.
 * 시·도가 목록에 없으면 null, 시·군·구가 없으면 그 시·도의 첫 시·군·구로 둔다.
 */
export function toRegionAnchor(
  doc: KakaoRegionDoc,
  lat: number,
  lng: number,
): RegionAnchorResult | null {
  const depth1 = doc.region_1depth_name ?? '';
  const compact1 = depth1.replace(/\s+/g, '');
  const province = KOREAN_PROVINCES.find(
    (p) =>
      compact1.includes(p.label) ||
      compact1.includes(p.fullLabel.replace(/\s+/g, '')) ||
      p.fullLabel.includes(depth1),
  );
  if (!province) return null;

  const depth2 = doc.region_2depth_name ?? '';
  const district = province.districts.find(
    (d) =>
      d.name === depth2.replace(/(시|군|구)$/, '') ||
      depth2.includes(d.name) ||
      depth2.includes(d.label),
  );
  return anchor(
    province.label,
    district?.name ?? province.districts[0]?.name ?? '',
    lat,
    lng,
  );
}
