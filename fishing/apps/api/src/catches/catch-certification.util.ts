import type { PrismaService } from '../prisma/prisma.service';
import type { AiService } from '../ai/ai.service';
import { resolveSpeciesId } from '../ai/species-slug.util';
import { determineGrade } from '../common/certification/certification-grade.util';
import { computeRankScore } from '../common/certification/rank-score.util';

/**
 * AI 분석 결과로 인증 등급·상태·랭킹 점수를 정해 기록에 반영하고 인증서를 남긴다.
 * 길이는 줄자 측정값, 점수는 길이 × 어종 희귀도(등급이 랭킹 대상일 때만).
 */
export async function certifyCatchWithAi(
  prisma: PrismaService,
  aiService: AiService,
  catchId: string,
  imageUrl: string,
) {
  const analysis = await aiService.analyze(catchId, imageUrl);

  const rules = {
    ruleFlat: analysis.ruleFlat,
    ruleVertical: analysis.ruleVertical,
    ruleRuler: analysis.ruleRuler,
    ruleFullBody: analysis.ruleFullBody,
  };
  const gradeResult = determineGrade({
    rulerDetected: analysis.rulerDetected,
    speciesConfidence: analysis.speciesConfidence,
    rules,
  });

  const fishSpeciesId = resolveSpeciesId(analysis.speciesDetected);
  const species = fishSpeciesId
    ? await prisma.fishSpecies.findUnique({ where: { id: fishSpeciesId } })
    : null;

  const lengthCm = analysis.rulerLengthCm;
  const rankScore = computeRankScore(
    lengthCm,
    species?.rarityWeight ?? 1,
    gradeResult.rankScoreEligible,
  );

  await prisma.catch.update({
    where: { id: catchId },
    data: {
      status: gradeResult.status,
      fishSpeciesId: species?.id ?? null,
      lengthCm,
      aiLengthCm: lengthCm,
      aiConfidence: analysis.speciesConfidence,
      rankScore,
    },
  });

  await prisma.certification.create({
    data: {
      catchId,
      grade: gradeResult.grade,
      rulerDetected: analysis.rulerDetected,
      rulerStartPx: analysis.rulerStartPx,
      rulerEndPx: analysis.rulerEndPx,
      rulerLengthCm: analysis.rulerLengthCm,
      speciesDetected: species?.nameKo ?? analysis.speciesDetected,
      speciesConfidence: analysis.speciesConfidence,
      ...rules,
      processedAt: new Date(),
      errorMessage:
        gradeResult.status === 'rejected' ? gradeResult.reason : null,
    },
  });
}
