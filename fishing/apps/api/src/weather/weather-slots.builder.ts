import {
  getFishingCondition,
  type FishingCondition,
} from './fishing-condition';
import {
  formatHourLabel,
  parsePrecipitation,
  ptyToLabel,
  skyToLabel,
  windDirectionLabel,
} from './kma-parser';
import type { WeatherCurrent, WeatherSlot } from './weather.types';

/** 시간대별 슬롯(1시간 단위) 만들기: 기상청 관측·예보 → 슬롯, 빈 시간은 가까운 예보로 추정 */

type SlotDraft = Partial<WeatherSlot> & {
  time: string;
  date: string;
  hour: number;
};
type KmaValues = Record<string, string>;

/** 슬롯 키 'YYYYMMDDHH00' */
export function slotTime(date: string, hour: number) {
  return `${date}${String(hour).padStart(2, '0')}00`;
}

/** 슬롯 낚시 지수. 기온이 없으면 15℃ 로 본다. */
function slotFishingCondition(s: {
  temp: number | null;
  windSpeed: number;
  precipitation: number;
  precipitationType: number;
  precipitationProb?: number | null;
}): FishingCondition {
  return getFishingCondition({
    temp: s.temp ?? 15,
    windSpeed: s.windSpeed,
    precipitation: s.precipitation,
    precipitationType: s.precipitationType,
    precipitationProb: s.precipitationProb,
  });
}

/** 초단기실황 + 가장 가까운 초단기예보로 현재 날씨를 만든다. */
export function buildCurrent(
  ncst: KmaValues,
  nearestFcst: KmaValues,
  observed: { baseDate: string; baseTime: string },
): WeatherCurrent {
  const pty = Number(ncst.PTY ?? 0);
  const sky = Number(nearestFcst.SKY ?? (pty > 0 ? 4 : 1));
  const vec = Number(ncst.VEC ?? 0);
  return {
    temp: Number(ncst.T1H ?? nearestFcst.T1H ?? 0),
    humidity: Number(ncst.REH ?? nearestFcst.REH ?? 0),
    windSpeed: Number(ncst.WSD ?? 0),
    windDirection: vec,
    windDirectionLabel: windDirectionLabel(vec),
    precipitation: parsePrecipitation(ncst.RN1),
    precipitationType: pty,
    precipitationLabel: ptyToLabel(pty),
    sky,
    skyLabel: skyToLabel(sky),
    observedAt: `${observed.baseDate} ${observed.baseTime}`,
  };
}

/** 두 예보가 같이 쓰는 칸(습도·바람·하늘·강수형태) */
function commonForecastFields(values: KmaValues): Partial<SlotDraft> {
  const pty = Number(values.PTY ?? 0);
  const sky = Number(values.SKY ?? 1);
  const vec = Number(values.VEC ?? 0);
  return {
    humidity: values.REH != null ? Number(values.REH) : undefined,
    windSpeed: Number(values.WSD ?? 0),
    windDirection: vec,
    windDirectionLabel: windDirectionLabel(vec),
    precipitationType: pty,
    precipitationLabel: ptyToLabel(pty),
    sky,
    skyLabel: skyToLabel(sky),
    hasForecast: true,
  };
}

/**
 * 현재 관측 → 초단기예보 → 단기예보 순으로 같은 시각 칸을 덮어쓰며 시간대별 슬롯을 만든다.
 * 값이 없는(undefined) 칸은 앞의 값을 지우지 않는다.
 */
export function buildForecastSlots(
  current: WeatherCurrent,
  observedTime: string,
  ultraFcst: Record<string, KmaValues>,
  vilageFcst: Record<string, KmaValues>,
): WeatherSlot[] {
  const slotMap = new Map<string, SlotDraft>();
  const upsert = (time: string, patch: Partial<SlotDraft>) => {
    const existing = slotMap.get(time) ?? {
      time,
      date: time.slice(0, 8),
      hour: Number(time.slice(8, 10)),
    };
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    slotMap.set(time, { ...existing, ...clean });
  };

  upsert(observedTime, {
    temp: current.temp,
    humidity: current.humidity,
    windSpeed: current.windSpeed,
    windDirection: current.windDirection,
    windDirectionLabel: current.windDirectionLabel,
    precipitation: current.precipitation,
    precipitationType: current.precipitationType,
    precipitationLabel: current.precipitationLabel,
    sky: current.sky,
    skyLabel: current.skyLabel,
    precipitationProb: null,
    wave: null,
    hasForecast: true,
    isCurrent: true,
  });

  for (const [time, values] of Object.entries(ultraFcst)) {
    upsert(time, {
      ...commonForecastFields(values),
      temp: values.T1H != null ? Number(values.T1H) : undefined,
      precipitation: parsePrecipitation(values.RN1),
      precipitationProb: null,
      wave: null,
    });
  }

  for (const [time, values] of Object.entries(vilageFcst)) {
    upsert(time, {
      ...commonForecastFields(values),
      temp: values.TMP != null ? Number(values.TMP) : undefined,
      precipitation: values.PCP ? parsePrecipitation(values.PCP) : undefined,
      precipitationProb: values.POP != null ? Number(values.POP) : undefined,
      wave: values.WAV != null ? Number(values.WAV) : undefined,
    });
  }

  return [...slotMap.values()]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map(toSlot);
}

function toSlot(draft: SlotDraft): WeatherSlot {
  const temp = draft.temp ?? null;
  const windSpeed = draft.windSpeed ?? 0;
  const precipitation = draft.precipitation ?? 0;
  const precipitationType = draft.precipitationType ?? 0;

  return {
    time: draft.time,
    date: draft.date,
    hour: draft.hour,
    hourLabel: formatHourLabel(draft.hour),
    temp,
    humidity: draft.humidity ?? null,
    windSpeed,
    windDirection: draft.windDirection ?? 0,
    windDirectionLabel:
      draft.windDirectionLabel ?? windDirectionLabel(draft.windDirection ?? 0),
    precipitation,
    precipitationProb: draft.precipitationProb ?? null,
    precipitationType,
    precipitationLabel:
      draft.precipitationLabel ?? ptyToLabel(precipitationType),
    sky: draft.sky ?? 1,
    skyLabel: draft.skyLabel ?? skyToLabel(draft.sky ?? 1),
    wave: draft.wave ?? null,
    hasForecast: draft.hasForecast ?? true,
    isEstimated: draft.isEstimated,
    fishingCondition: slotFishingCondition({
      temp,
      windSpeed,
      precipitation,
      precipitationType,
      precipitationProb: draft.precipitationProb,
    }),
    isCurrent: draft.isCurrent,
  };
}

/** 하루 24칸을 채운다. 예보가 없는 시간은 가장 가까운 예보 시간 값으로 추정한다. */
export function fill24HourSlots(
  date: string,
  slots: WeatherSlot[],
): WeatherSlot[] {
  const byHour = new Map(slots.map((s) => [s.hour, s]));
  const withData = slots.filter((s) => s.hasForecast);
  const sources = withData.length > 0 ? withData : slots;
  const fallback = withData[0] ?? slots[0];

  return Array.from(
    { length: 24 },
    (_, hour) =>
      byHour.get(hour) ??
      (fallback
        ? estimatedSlot(date, hour, sources, fallback)
        : emptySlot(date, hour)),
  );
}

function estimatedSlot(
  date: string,
  hour: number,
  sources: WeatherSlot[],
  fallback: WeatherSlot,
): WeatherSlot {
  const nearest = sources.reduce(
    (best, s) =>
      Math.abs(s.hour - hour) < Math.abs(best.hour - hour) ? s : best,
    sources[0],
  );
  const temp = nearest.temp ?? fallback.temp;
  const windSpeed = nearest.windSpeed ?? fallback.windSpeed;
  const precipitationType =
    nearest.precipitationType ?? fallback.precipitationType;
  const precipitation = nearest.precipitation ?? 0;
  const precipitationProb =
    nearest.precipitationProb ?? fallback.precipitationProb;

  return {
    time: slotTime(date, hour),
    date,
    hour,
    hourLabel: formatHourLabel(hour),
    temp,
    humidity: nearest.humidity ?? fallback.humidity,
    windSpeed,
    windDirection: nearest.windDirection ?? fallback.windDirection,
    windDirectionLabel:
      nearest.windDirectionLabel ?? fallback.windDirectionLabel,
    precipitation,
    precipitationProb,
    precipitationType,
    precipitationLabel:
      nearest.precipitationLabel ?? fallback.precipitationLabel,
    sky: nearest.sky ?? fallback.sky,
    skyLabel: nearest.skyLabel ?? fallback.skyLabel,
    wave: nearest.wave ?? fallback.wave,
    hasForecast: false,
    isEstimated: true,
    fishingCondition: slotFishingCondition({
      temp,
      windSpeed,
      precipitation,
      precipitationType,
      precipitationProb,
    }),
  };
}

function emptySlot(date: string, hour: number): WeatherSlot {
  return {
    time: slotTime(date, hour),
    date,
    hour,
    hourLabel: formatHourLabel(hour),
    temp: null,
    humidity: null,
    windSpeed: 0,
    windDirection: 0,
    windDirectionLabel: '-',
    precipitation: 0,
    precipitationProb: null,
    precipitationType: 0,
    precipitationLabel: '-',
    sky: 1,
    skyLabel: '-',
    wave: null,
    hasForecast: false,
    isEstimated: false,
    fishingCondition: {
      label: '예보 없음',
      color: '#9e9e9e',
      desc: '해당 시간 예보 데이터가 없습니다.',
      score: 0,
    },
  };
}
