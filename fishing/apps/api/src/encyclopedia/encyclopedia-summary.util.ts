import type { FishCatalogEntry } from '../fish-info/fish-species-catalog';

const CATEGORY_PLACE: Record<string, string> = {
  freshwater: '민물',
  saltwater: '바다',
  both: '민물·바다',
};

/** 공식 설명 → 카탈로그 힌트 → 분류 문장 순으로 한 줄 요약을 만든다. */
export function buildSpeciesSummary(
  nameKo: string,
  description: string | null | undefined,
  category: string,
  catalog?: FishCatalogEntry,
): string {
  const fromDescription = summaryFromDescription(nameKo, description);
  if (fromDescription && !isCodeTaxonomy(fromDescription))
    return fromDescription;

  const hints = catalog
    ? [catalog.season, catalog.bait, catalog.technique].filter(Boolean)
    : [];
  if (hints.length) return truncate(`${nameKo} — ${hints.join(' · ')}`, 280);

  const place = CATEGORY_PLACE[category] ?? '민물';
  return `${nameKo}${subjectParticle(nameKo)} ${place}에서 만날 수 있는 어종이에요.`;
}

/** 설명의 "분포: ..." 줄을 서식지로 쓴다. */
export function extractHabitat(
  description: string | null | undefined,
): string | null {
  const match = description?.match(/분포:\s*(.+)/);
  return match?.[1]?.trim().slice(0, 200) ?? null;
}

function summaryFromDescription(
  nameKo: string,
  description: string | null | undefined,
): string | null {
  const line = description
    ?.split('\n')
    .map((l) => l.trim())
    .find(
      (l) =>
        l &&
        !/^출처:|^학명:|^분류:/.test(l) &&
        l.length >= 12 &&
        !l.startsWith(`${nameKo}(`) &&
        !l.startsWith(`${nameKo}（`),
    );
  return line ? truncate(line, 280) : null;
}

/** "AB > CD" 같은 분류 코드만 있는 줄 */
function isCodeTaxonomy(text: string): boolean {
  return /^[A-Z]{2}(\s*>\s*[A-Z]{2})+$/i.test(text.trim());
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trim()}…`;
}

/** 받침이 있으면 '은', 없거나 한글이 아니면 '는' */
function subjectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (!word || code < 0xac00 || code > 0xd7a3) return '는';
  return (code - 0xac00) % 28 === 0 ? '는' : '은';
}
