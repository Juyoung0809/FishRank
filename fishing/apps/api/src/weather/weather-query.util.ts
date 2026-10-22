import { BadRequestException } from '@nestjs/common';

export const KOREA_ONLY_MESSAGE =
  '한국 지역 좌표만 지원합니다 (lat 33~39, lng 124~132)';

/** 필수 위경도. koreaOnlyMessage 를 주면 국내 범위(33~39, 124~132)도 확인한다. */
export function requireLatLng(
  latStr: string,
  lngStr: string,
  koreaOnlyMessage?: string,
) {
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new BadRequestException('lat, lng는 숫자여야 합니다');
  }
  if (koreaOnlyMessage && (lat < 33 || lat > 39 || lng < 124 || lng > 132)) {
    throw new BadRequestException(koreaOnlyMessage);
  }
  return { lat, lng };
}

/** 선택 숫자 쿼리. 숫자가 아니면 undefined */
export function optionalNumber(value?: string) {
  const n = value != null ? Number(value) : undefined;
  return Number.isFinite(n) ? n : undefined;
}
