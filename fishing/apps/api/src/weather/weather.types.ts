import type { FishingCondition } from './fishing-condition';
import type { SunMoonInfo } from './sun-moon';
import type { TideInfo } from './tide';

export type WeatherCurrent = {
  temp: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  windDirectionLabel: string;
  precipitation: number;
  precipitationType: number;
  precipitationLabel: string;
  sky: number;
  skyLabel: string;
  observedAt: string;
};

export type WeatherSlot = {
  time: string;
  date: string;
  hour: number;
  hourLabel: string;
  temp: number | null;
  humidity: number | null;
  windSpeed: number;
  windDirection: number;
  windDirectionLabel: string;
  precipitation: number;
  precipitationProb: number | null;
  precipitationType: number;
  precipitationLabel: string;
  sky: number;
  skyLabel: string;
  wave: number | null;
  hasForecast: boolean;
  isEstimated?: boolean;
  fishingCondition: FishingCondition;
  isCurrent?: boolean;
};

export type WeatherDay = {
  date: string;
  dateLabel: string;
  minTemp: number | null;
  maxTemp: number | null;
  avgWindSpeed: number;
  maxPrecipProb: number | null;
  bestHour: number | null;
  bestScore: number;
  bestHours: number[];
  sunMoon: SunMoonInfo;
  tide: TideInfo;
  slots: WeatherSlot[];
};

export type WeatherSummary = {
  location: {
    lat: number;
    lng: number;
    nx: number;
    ny: number;
    label?: string;
  };
  current: WeatherCurrent;
  days: WeatherDay[];
  fishingCondition: FishingCondition;
  bestTimesToday: {
    hour: number;
    hourLabel: string;
    score: number;
    label: string;
  }[];
  source: 'kma';
  forecastAvailable: boolean;
  forecastNotice?: string;
};
