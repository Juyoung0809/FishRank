import { haversineKm } from '../geo.util';
import { createHash } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import exifr from 'exifr';

/** 인증 업로드 허용 최대 촬영 경과 시간 (시간) */
export const CERTIFIED_MAX_PHOTO_AGE_HOURS = 72;

/** EXIF GPS와 사용자가 적은 장소가 이보다 멀면 인증 업로드를 거절한다. */
export const GPS_CLAIM_MISMATCH_KM = 50;

export async function computeImageHash(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

export async function removeUploadedFile(filePath?: string): Promise<void> {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // ignore missing file
  }
}

export type PhotoFreshnessResult =
  | {
      ok: true;
      takenAt?: Date;
      exifMissing?: boolean;
      exifLat?: number;
      exifLng?: number;
      integrityNote?: string;
    }
  | { ok: false; reason: string };

export type ClaimedLocation = { lat?: number; lng?: number };

export function appendIntegrityNote(
  note: string | undefined,
  flag: string,
): string {
  const parts = new Set(
    (note ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
  parts.add(flag);
  return [...parts].join(',');
}

export function isPlausibleGps(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;
  return true;
}

export { haversineKm };

export function assertGpsSanity(
  exifLat: number | undefined,
  exifLng: number | undefined,
  claim?: ClaimedLocation,
): { ok: true } | { ok: false; reason: string } {
  const hasExif = exifLat !== undefined || exifLng !== undefined;
  if (hasExif) {
    if (
      exifLat === undefined ||
      exifLng === undefined ||
      !isPlausibleGps(exifLat, exifLng)
    ) {
      return {
        ok: false,
        reason: '사진의 GPS 좌표가 올바르지 않습니다. 원본 사진을 올려주세요.',
      };
    }
  }

  const claimLat = claim?.lat;
  const claimLng = claim?.lng;
  const hasClaim =
    claimLat !== undefined &&
    claimLng !== undefined &&
    Number.isFinite(claimLat) &&
    Number.isFinite(claimLng);
  if (hasExif && hasClaim && exifLat !== undefined && exifLng !== undefined) {
    const distance = haversineKm(
      exifLat,
      exifLng,
      claimLat as number,
      claimLng as number,
    );
    if (distance > GPS_CLAIM_MISMATCH_KM) {
      return {
        ok: false,
        reason: `사진 GPS와 입력한 장소가 ${GPS_CLAIM_MISMATCH_KM}km 이상 떨어져 있습니다.`,
      };
    }
  }

  return { ok: true };
}

/**
 * EXIF 촬영 시각·GPS 검증.
 * 시각이 있으면 72시간 이내만 허용하고, GPS가 있으면 범위와 입력 장소와의 거리를 본다.
 * 시각이나 GPS가 없는 사진은 막지 않고 integrityNote에 남긴다.
 */
export async function validatePhotoFreshness(
  filePath: string,
  maxAgeHours = CERTIFIED_MAX_PHOTO_AGE_HOURS,
  claim?: ClaimedLocation,
): Promise<PhotoFreshnessResult> {
  try {
    const exif = await exifr.parse(filePath, { gps: true });
    const takenRaw =
      exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.ModifyDate;
    const notes: string[] = [];

    let takenAt: Date | undefined;
    if (!takenRaw) {
      notes.push('date_missing');
    } else {
      const parsed = takenRaw instanceof Date ? takenRaw : new Date(takenRaw);
      if (Number.isNaN(parsed.getTime())) {
        notes.push('date_missing');
      } else {
        const ageMs = Date.now() - parsed.getTime();
        const maxMs = maxAgeHours * 60 * 60 * 1000;
        if (ageMs > maxMs) {
          return {
            ok: false,
            reason: `촬영 시각이 ${maxAgeHours}시간을 초과한 사진입니다. 최근 촬영한 원본 사진을 올려주세요.`,
          };
        }
        if (ageMs < -5 * 60 * 1000) {
          return {
            ok: false,
            reason: '촬영 시각이 미래로 설정된 사진은 업로드할 수 없습니다.',
          };
        }
        takenAt = parsed;
      }
    }

    const exifLat =
      typeof exif?.latitude === 'number' ? exif.latitude : undefined;
    const exifLng =
      typeof exif?.longitude === 'number' ? exif.longitude : undefined;
    if (exifLat === undefined && exifLng === undefined)
      notes.push('gps_missing');

    const gps = assertGpsSanity(exifLat, exifLng, claim);
    if (!gps.ok) return gps;

    return {
      ok: true,
      takenAt,
      exifMissing: !takenAt,
      exifLat,
      exifLng,
      integrityNote: notes.length ? notes.join(',') : undefined,
    };
  } catch {
    return {
      ok: true,
      exifMissing: true,
      integrityNote: 'date_missing,gps_missing',
    };
  }
}
