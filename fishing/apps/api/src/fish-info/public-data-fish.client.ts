import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  extractOdcloudItems,
  extractPublicDataItems,
  getPublicDataResultCode,
  isOdcloudUrl,
  pickField,
} from './data-go-kr.util';
import { extractNifsItems, getNifsResultCode } from './nifs.util';
import {
  buildRecord,
  FRESHWATER_FIELDS,
  MARINE_FIELDS,
  NIFS_FIELDS,
  odcloudTaxonomy,
  pickBestItem,
  type FieldMap,
} from './public-fish-record.util';

export type PublicFishRecord = {
  nameKo: string | null;
  nameEn: string | null;
  scientificName: string | null;
  taxonomy: string | null;
  habitat: string | null;
  distribution: string | null;
  ecology: string | null;
  morphology: string | null;
  source: 'mbris' | 'mof' | 'nifs' | 'nakdong';
  matched: boolean;
};

/** 해양수산부 해양생물종기본정보(odcloud) 어류 행 */
export type MofFishSpeciesRow = {
  nameKo: string;
  nameEn: string | null;
  scientificName: string;
  taxonomy: string | null;
  category: 'freshwater' | 'saltwater' | 'brackish';
};

/** 공공 생물종 API(MBRIS·해양수산부·국립수산과학원·낙동강) 조회. 실패하면 null·[] */
@Injectable()
export class PublicDataFishClient {
  constructor(private config: ConfigService) {}

  private get serviceKey(): string | null {
    return this.config.get<string>('DATA_GO_KR_SERVICE_KEY') ?? null;
  }

  private get nifsApiKey(): string | null {
    return this.config.get<string>('NIFS_API_KEY') ?? null;
  }

  /** 바다 어종은 MBRIS → 해양수산부 → 수산과학원, 민물은 수산과학원 → 해양수산부 → 낙동강 순 */
  async searchByCategory(
    nameKo: string,
    category: 'freshwater' | 'saltwater' | 'brackish',
    scientificName?: string,
  ): Promise<PublicFishRecord | null> {
    if (category === 'saltwater' || category === 'brackish') {
      return (
        (await this.searchMarineSpecies(nameKo, scientificName)) ??
        (await this.searchMarineBasicInfo(nameKo, scientificName)) ??
        (await this.searchNifsSpecies(nameKo, scientificName))
      );
    }
    return (
      (await this.searchNifsSpecies(nameKo, scientificName)) ??
      (await this.searchMarineBasicInfo(nameKo, scientificName)) ??
      (await this.searchFreshwaterBioResource(nameKo, scientificName))
    );
  }

  async searchMarineSpecies(
    nameKo: string,
    scientificName?: string,
  ): Promise<PublicFishRecord | null> {
    const baseUrl = this.config.get<string>('MBRIS_MARINE_SPECIES_URL');
    if (!baseUrl || !this.serviceKey) return null;
    return this.fetchDataGoKrBestMatch(
      baseUrl,
      { korNm: nameKo },
      'mbris',
      nameKo,
      scientificName,
      MARINE_FIELDS,
    );
  }

  async searchMarineBasicInfo(
    nameKo: string,
    scientificName?: string,
  ): Promise<PublicFishRecord | null> {
    const baseUrl = this.config.get<string>('MOF_MARINE_SPECIES_URL');
    if (!baseUrl || !this.serviceKey) return null;
    return this.fetchDataGoKrBestMatch(
      baseUrl,
      { korNm: nameKo, speciesNm: nameKo },
      'mof',
      nameKo,
      scientificName,
      MARINE_FIELDS,
    );
  }

  /** 국립수산과학원 생물종정보 (nifs.go.kr 별도 키) */
  async searchNifsSpecies(
    nameKo: string,
    scientificName?: string,
  ): Promise<PublicFishRecord | null> {
    if (!this.nifsApiKey) return null;

    const baseUrl =
      this.config.get<string>('NIFS_API_URL') ??
      'https://www.nifs.go.kr/OpenAPI_json';
    const apiId =
      this.config.get<string>('NIFS_SPECIES_API_ID') ?? 'speciesList';
    const nameParam =
      this.config.get<string>('NIFS_SPECIES_NAME_PARAM') ?? 'spcsKrnNm';

    return axios
      .get(baseUrl, {
        params: {
          id: apiId,
          key: this.nifsApiKey,
          [nameParam]: nameKo,
          pageNo: 1,
          numOfRows: 20,
        },
        timeout: 15000,
      })
      .then((res) => {
        const code = getNifsResultCode(res.data);
        if (code && code !== '00') return null;
        const items = extractNifsItems(res.data);
        return items.length
          ? buildRecord(items, nameKo, scientificName, 'nifs', NIFS_FIELDS)
          : null;
      })
      .catch(() => null);
  }

  /** 국립낙동강생물자원관 담수생물자원 조회 (15139801) — /bioresource */
  async searchFreshwaterBioResource(
    nameKo: string,
    scientificName?: string,
  ): Promise<PublicFishRecord | null> {
    const baseUrl = this.config.get<string>('NAKDONG_FRESHWATER_URL');
    if (!baseUrl || !this.serviceKey) return null;

    // 서버 검색 파라미터 미지원 → 여러 페이지를 훑으며 클라이언트 매칭
    for (let pageNo = 1; pageNo <= 3; pageNo++) {
      const items = await this.fetchNakdongPage(baseUrl, pageNo, 100);
      const item = pickBestItem(
        items,
        nameKo,
        scientificName,
        FRESHWATER_FIELDS,
        false,
      );
      if (!item) continue;

      const record = buildRecord(
        [item],
        nameKo,
        scientificName,
        'nakdong',
        FRESHWATER_FIELDS,
      );
      if (record?.matched) return record;
    }
    return null;
  }

  /** 해양수산부 DB에서 어류(FI)·종(species) 전체 목록 수집 (학명 중복 제거) */
  async fetchAllMofFishSpecies(): Promise<MofFishSpeciesRow[]> {
    const baseUrl = this.config.get<string>('MOF_MARINE_SPECIES_URL');
    if (!baseUrl || !this.serviceKey || !isOdcloudUrl(baseUrl)) return [];

    const perPage = 100;
    const rows: MofFishSpeciesRow[] = [];
    const seen = new Set<string>();
    let matchCount = Number.POSITIVE_INFINITY;

    for (let page = 1; (page - 1) * perPage < matchCount; page++) {
      const res = await axios
        .get(baseUrl, {
          params: {
            serviceKey: this.serviceKey,
            page,
            perPage,
            'cond[생물분류중분류::EQ]': 'FI',
            'cond[종동정등급::EQ]': 'species',
          },
          timeout: 30000,
        })
        .catch(() => null);
      if (!res?.data) break;

      matchCount = Number(res.data.matchCount ?? res.data.totalCount ?? 0);
      const items = extractOdcloudItems(res.data);
      if (!items.length) break;

      for (const row of items.map(mapMofFishRow)) {
        if (!row || seen.has(row.scientificName.toLowerCase())) continue;
        seen.add(row.scientificName.toLowerCase());
        rows.push(row);
      }
    }
    return rows;
  }

  private fetchNakdongPage(
    baseUrl: string,
    pageNo: number,
    numOfRows: number,
  ): Promise<Record<string, unknown>[]> {
    return axios
      .get(baseUrl, {
        params: {
          serviceKey: this.serviceKey,
          pageNo,
          numOfRows,
          resultType: 'json',
        },
        timeout: 20000,
      })
      .then((res) => {
        const code = getPublicDataResultCode(res.data);
        return code && code !== '00' ? [] : extractPublicDataItems(res.data);
      })
      .catch(() => []);
  }

  private fetchDataGoKrBestMatch(
    baseUrl: string,
    queryParams: Record<string, string>,
    source: PublicFishRecord['source'],
    expectedNameKo: string,
    expectedScientific: string | undefined,
    fields: FieldMap,
  ): Promise<PublicFishRecord | null> {
    if (!this.serviceKey) return Promise.resolve(null);

    // odcloud 는 국명 LIKE 검색, 그 밖의 data.go.kr 은 쿼리 파라미터 검색
    const odcloud = isOdcloudUrl(baseUrl);
    const params = odcloud
      ? {
          serviceKey: this.serviceKey,
          page: 1,
          perPage: 20,
          'cond[국명::LIKE]': expectedNameKo,
        }
      : {
          serviceKey: this.serviceKey,
          pageNo: 1,
          numOfRows: 20,
          resultType: 'json',
          type: 'json',
          ...queryParams,
        };

    return axios
      .get(baseUrl, { params, timeout: 15000 })
      .then((res) => {
        if (!odcloud) {
          const code = getPublicDataResultCode(res.data);
          if (code && code !== '00') return null;
        }
        const items = odcloud
          ? extractOdcloudItems(res.data)
          : extractPublicDataItems(res.data);
        return items.length
          ? buildRecord(
              items,
              expectedNameKo,
              expectedScientific,
              source,
              fields,
            )
          : null;
      })
      .catch(() => null);
  }
}

function mapMofFishRow(
  item: Record<string, unknown>,
): MofFishSpeciesRow | null {
  const nameKo = pickField(item, ['국명', 'korNm', 'koreanName']);
  const scientificName = pickField(item, ['학명', 'sciNm', 'scientificName']);
  if (!nameKo || !scientificName) return null;

  return {
    nameKo,
    nameEn: pickField(item, ['영명', 'engNm', 'englishName']),
    scientificName,
    taxonomy: odcloudTaxonomy(item),
    category: 'saltwater',
  };
}
