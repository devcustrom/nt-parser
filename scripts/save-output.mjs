import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import {
  enrichOfficesWithDadata,
  fetchOffices,
  saveOffices,
} from "../dist/esm/index.js";

loadEnv();

const apiKey = process.env.DADATA_API_KEY ?? "";

const result = await fetchOffices();
let offices = result.offices;

if (apiKey) {
  // Подтягиваем прошлое обогащение, чтобы не запрашивать Dadata повторно
  const previous = loadPreviousEnrichment();
  offices = offices.map((office) => {
    const cached = previous.get(office.id);
    return cached ? { ...office, dadata: cached } : office;
  });

  console.log("Обогащение через Dadata Suggestions…");
  const before = offices.filter((office) => office.dadata).length;
  offices = await enrichOfficesWithDadata(offices, {
    apiKey,
    secretKey: process.env.DADATA_SECRET_KEY ?? undefined,
  });
  const enriched = offices.filter((office) => office.dadata).length;
  console.log(`Уже обогащено из кэша: ${before}`);
  console.log(`Всего обогащено: ${enriched} / ${offices.length}`);
} else {
  console.log("Обогащение пропущено: задайте DADATA_API_KEY в .env файле.");
  console.log('Пример: echo "DADATA_API_KEY=ваш_ключ" > .env');
}

const { jsonPath, csvPath } = await saveOffices({ ...result, offices });

console.log(`ПВЗ получено: ${offices.length}`);
console.log(`JSON: ${jsonPath}`);
console.log(`CSV:  ${csvPath}`);

function loadPreviousEnrichment() {
  const previous = new Map();
  const path = "output/offices.json";
  if (!existsSync(path)) {
    return previous;
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const list = Array.isArray(data) ? data : data.offices;
    for (const office of list ?? []) {
      if (office?.dadata) {
        previous.set(office.id, office.dadata);
      }
    }
  } catch (err) {
    console.error(`Не удалось прочитать прошлые данные (${path}): ${String(err)}`);
  }
  return previous;
}