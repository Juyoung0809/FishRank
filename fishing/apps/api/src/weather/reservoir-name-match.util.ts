import type { KakaoPlaceDoc } from './kakao-local.api';

/** 이름에 물 관련 단어가 있는 장소 */
export const WATER_PLACE_RE =
  /저수지|저수면|저류지|유수지|배수지|댐|호수|(^|[^가-힣])호([^가-힣]|$)|reservoir/i;
const WATER_CATEGORY_RE = /저수지|호수|댐|하천|강|바다|섬|산|관광|명소|여행/i;
/** 동명 건물·학교·공장 등 저수지가 아닌 장소 */
export const REJECT_PLACE_RE =
  /서당|학교|학원|유치원|어린이집|정밀|공장|공단|주식회사|㈜|\(주\)|아파트|오피스텔|빌딩|카페|식당|병원|교회|마트|편의점|주유소|주차장|PC방|노래방|은행|관공서|시청|동사무소|우체국|헬스|미용|부동산|모텔|호텔|펜션(?!.*호수)/i;

export function normalizeReservoirName(facName: string): string {
  return (
    facName
      .replace(/\(.*?\)/g, '')
      .replace(/저수지|저수면|댐|호수/g, '')
      .trim() || facName.trim()
  );
}

/** 카카오 장소가 KRC 저수지와 같은 곳일 점수. 음수면 저수지가 아님 */
export function scoreReservoirMatch(
  doc: KakaoPlaceDoc,
  baseName: string,
  facName: string,
  countyHint: string,
): number {
  const name = doc.place_name ?? '';
  const cat = `${doc.category_name ?? ''} ${doc.category_group_name ?? ''}`;
  const addr = doc.address_name ?? '';

  if (REJECT_PLACE_RE.test(name)) return -1;
  if (REJECT_PLACE_RE.test(cat) && !WATER_PLACE_RE.test(name)) return -1;

  const hasWaterInName = WATER_PLACE_RE.test(name);
  const hasWaterInCat =
    WATER_CATEGORY_RE.test(cat) && /저수지|호수|댐|하천|강/.test(cat);
  if (!hasWaterInName && !hasWaterInCat) return -1;

  let score = 0;
  if (hasWaterInName) score += 50;
  if (/저수지|댐/.test(name)) score += 25;
  if (hasWaterInCat) score += 15;

  const compactName = name.replace(/\s+/g, '');
  const compactBase = baseName.replace(/\s+/g, '');
  const compactFac = facName.replace(/\s+/g, '');
  if (compactBase.length >= 2 && compactName.includes(compactBase)) score += 35;
  if (compactFac.length >= 2 && compactName.includes(compactFac)) score += 20;
  if (countyHint && addr.includes(countyHint)) score += 25;

  // 이름에 물 관련 키워드가 없고 카테고리만 관광/산이면 약함
  if (!hasWaterInName && /산|관광|명소/.test(cat)) score -= 20;

  return score;
}
