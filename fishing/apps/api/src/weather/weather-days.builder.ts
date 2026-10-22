import { formatDateLabel } from './kma-parser';
import { getSunMoonInfo } from './sun-moon';
import { getTideInfo } from './tide';
import { fill24HourSlots, slotTime } from './weather-slots.builder';
import type { WeatherDay, WeatherSlot } from './weather.types';

/** 날짜별 요약 만들기: 슬롯 → 하루 요약(기온·바람·최적 시간·해달·물때), 예보가 없는 날까지 7일 채우기 */

/** 점수 높은 순으로 상위 슬롯 */
function topSlots(slots: WeatherSlot[], count = 3) {
  return [...slots]
    .sort((a, b) => b.fishingCondition.score - a.fishingCondition.score)
    .slice(0, count);
}

/** 오늘 예보 중 낚시하기 좋은 시간 3개 */
export function bestTimesOf(day: WeatherDay | undefined) {
  if (!day) return [];
  return topSlots(day.slots.filter((s) => s.hasForecast)).map((s) => ({
    hour: s.hour,
    hourLabel: s.hourLabel,
    score: s.fishingCondition.score,
    label: s.fishingCondition.label,
  }));
}

/**
 * 슬롯을 날짜별로 묶어 최저·최고 기온, 평균 풍속, 최고 점수 시간, 해·달·물때를 붙인다.
 * 오늘은 단기예보 최저·최고에 현재 기온과 남은 시간대 예보를 함께 반영한다.
 */
export function groupSlotsByDay(
  slots: WeatherSlot[],
  lat: number,
  lng: number,
  dailyMinMax: Map<string, { min?: number; max?: number }>,
  todayDate: string,
  currentTemp: number,
): WeatherDay[] {
  const dayMap = new Map<string, WeatherSlot[]>();
  for (const slot of slots) {
    if (!dayMap.has(slot.date)) dayMap.set(slot.date, []);
    dayMap.get(slot.date)!.push(slot);
  }

  return [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySlots]) => {
      const { minTemp, maxTemp } = dayTempRange(
        daySlots,
        dailyMinMax.get(date),
        date === todayDate,
        currentTemp,
      );

      const winds = daySlots.map((s) => s.windSpeed);
      const pops = daySlots
        .map((s) => s.precipitationProb)
        .filter((p): p is number => p != null);
      const forecastSlots = daySlots.filter((s) => s.hasForecast);
      const scoreSlots = forecastSlots.length > 0 ? forecastSlots : daySlots;
      const best = scoreSlots.reduce(
        (acc, slot) =>
          slot.fishingCondition.score > acc.score
            ? { hour: slot.hour, score: slot.fishingCondition.score }
            : acc,
        {
          hour: scoreSlots[0]?.hour ?? null,
          score: scoreSlots[0]?.fishingCondition.score ?? 0,
        },
      );

      return {
        date,
        dateLabel: formatDateLabel(date),
        minTemp,
        maxTemp,
        avgWindSpeed: winds.length
          ? winds.reduce((a, b) => a + b, 0) / winds.length
          : 0,
        maxPrecipProb: pops.length ? Math.max(...pops) : null,
        bestHour: best.hour,
        bestScore: best.score,
        bestHours: topSlots(scoreSlots).map((s) => s.hour),
        sunMoon: getSunMoonInfo(lat, lng, date),
        tide: getTideInfo(lat, lng, date),
        slots: fill24HourSlots(
          date,
          daySlots.sort((a, b) => a.hour - b.hour),
        ),
      };
    });
}

function dayTempRange(
  daySlots: WeatherSlot[],
  daily: { min?: number; max?: number } | undefined,
  isToday: boolean,
  currentTemp: number,
) {
  const forecastTemps = daySlots
    .filter((s) => s.hasForecast && s.temp != null)
    .map((s) => s.temp as number);
  const allTemps = daySlots
    .map((s) => s.temp)
    .filter((t): t is number => t != null);
  const temps = forecastTemps.length > 0 ? forecastTemps : allTemps;
  let minTemp = daily?.min ?? (temps.length ? Math.min(...temps) : null);
  let maxTemp = daily?.max ?? (temps.length ? Math.max(...temps) : null);

  if (isToday) {
    if (temps.length) {
      minTemp =
        minTemp != null ? Math.min(minTemp, ...temps) : Math.min(...temps);
      maxTemp =
        maxTemp != null ? Math.max(maxTemp, ...temps) : Math.max(...temps);
    }
    minTemp = minTemp != null ? Math.min(minTemp, currentTemp) : currentTemp;
    maxTemp = maxTemp != null ? Math.max(maxTemp, currentTemp) : currentTemp;
  } else if (daily) {
    minTemp = daily.min ?? minTemp;
    maxTemp = daily.max ?? maxTemp;
  }
  return { minTemp, maxTemp };
}

/** 'YYYYMMDD' 에 days 일을 더한다. */
function addDateDays(dateStr: string, days: number): string {
  const dt = new Date(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(4, 6)) - 1,
    Number(dateStr.slice(6, 8)) + days,
  );
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * 첫날부터 totalDays 일을 채운다. 예보가 없는 날은 예보가 있는 첫날을 본떠
 * 추정 슬롯으로 채우고, 해·달·물때는 그날 값으로 계산한다.
 */
export function buildExtendedDays(
  days: WeatherDay[],
  lat: number,
  lng: number,
  totalDays = 7,
): WeatherDay[] {
  if (days.length === 0) return days;

  const dayMap = new Map(days.map((d) => [d.date, d]));
  const template =
    days.find((d) => d.slots.some((s) => s.hasForecast)) ?? days[0];

  return Array.from({ length: totalDays }, (_, i) => {
    const date = addDateDays(days[0].date, i);
    const existing = dayMap.get(date);
    if (existing)
      return { ...existing, slots: fill24HourSlots(date, existing.slots) };

    const filled = fill24HourSlots(
      date,
      template.slots.map((s) => ({
        ...s,
        date,
        time: slotTime(date, s.hour),
        hasForecast: false,
        isEstimated: true,
        isCurrent: false,
      })),
    );
    const temps = filled
      .map((s) => s.temp)
      .filter((t): t is number => t != null);
    return {
      date,
      dateLabel: formatDateLabel(date),
      minTemp: temps.length ? Math.min(...temps) : null,
      maxTemp: temps.length ? Math.max(...temps) : null,
      avgWindSpeed: template.avgWindSpeed,
      maxPrecipProb: null,
      bestHour: template.bestHour,
      bestScore: template.bestScore,
      bestHours: template.bestHours,
      sunMoon: getSunMoonInfo(lat, lng, date),
      tide: getTideInfo(lat, lng, date),
      slots: filled,
    };
  });
}
