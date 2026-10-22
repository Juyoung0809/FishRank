import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FishSpeciesImportService } from '../src/fish-info/fish-species-import.service';

async function main() {
  console.log('🐟 해양수산부 공공데이터 어류 전종 가져오기...\n');

  if (!process.env.MOF_MARINE_SPECIES_URL) {
    console.error(
      '❌ MOF_MARINE_SPECIES_URL 이 .env에 설정되어 있지 않습니다.',
    );
    process.exit(1);
  }

  let app;
  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
  } catch (err) {
    if (isDbConnectionError(err)) {
      printDbHelp();
      process.exit(1);
    }
    throw err;
  }

  const service = app.get(FishSpeciesImportService);

  try {
    const result = await service.importPublicFishSpecies();
    console.log(`✅ 낚시 대상 어류 ${result.total}종 처리`);
    console.log(
      `   신규 ${result.created} · 갱신 ${result.updated} · 제거 ${result.pruned}`,
    );
    console.log(
      `   DB 사전 ${result.dbCount}종 (민물 ${result.freshwater} · 바다 ${result.saltwater})`,
    );
  } catch (err) {
    if (isDbConnectionError(err)) {
      printDbHelp();
      process.exit(1);
    }
    throw err;
  }

  await app.close();
}

function isDbConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Can't reach database server") || msg.includes('P1001');
}

function printDbHelp() {
  console.error('\n❌ PostgreSQL에 연결할 수 없습니다 (localhost:5433).');
  console.error('   1. Docker Desktop 실행');
  console.error('   2. npm run db:up');
  console.error('   3. npm run import:fish-species\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
