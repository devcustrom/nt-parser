import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnrichedOffice, Office } from "./types.js";

type Column = { name: string; get: (office: EnrichedOffice) => unknown };

const BASE_COLUMNS: Column[] = [
  { name: "id", get: (o) => o.id },
  { name: "code", get: (o) => o.code },
  { name: "city", get: (o) => o.city },
  { name: "address", get: (o) => o.address },
  { name: "latitude", get: (o) => o.latitude },
  { name: "longitude", get: (o) => o.longitude },
  { name: "workingHours", get: (o) => o.workingHours },
  { name: "phone", get: (o) => o.phone },
  { name: "email", get: (o) => o.email },
];

const DADATA_COLUMNS: Column[] = [
  { name: "dadata_result", get: (o) => o.dadata?.result },
  { name: "dadata_region", get: (o) => o.dadata?.region },
  { name: "dadata_city", get: (o) => o.dadata?.city },
  { name: "dadata_street", get: (o) => o.dadata?.street },
  { name: "dadata_house", get: (o) => o.dadata?.house },
  { name: "dadata_geo_lat", get: (o) => o.dadata?.geoLat },
  { name: "dadata_geo_lon", get: (o) => o.dadata?.geoLon },
  { name: "dadata_qc", get: (o) => o.dadata?.qc },
  { name: "dadata_fias_id", get: (o) => o.dadata?.fiasId },
];

function cell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Сериализует ПВЗ (и данные обогащения, если есть) в CSV (RFC 4180). */
export function toCsv(offices: readonly (Office | EnrichedOffice)[]): string {
  const enriched = offices as EnrichedOffice[];
  const hasDadata = enriched.some((office) => office.dadata);
  const columns = hasDadata ? [...BASE_COLUMNS, ...DADATA_COLUMNS] : BASE_COLUMNS;

  const rows = [columns.map((c) => cell(c.name)).join(",")];
  for (const office of enriched) {
    rows.push(columns.map((c) => cell(c.get(office))).join(","));
  }

  return rows.join("\r\n");
}

export interface SaveOfficesOptions {
  /** Каталог для файлов. По умолчанию `output`. */
  dir?: string;
  /** Базовое имя файлов. По умолчанию `offices`. */
  basename?: string;
}

export interface SaveOfficesData {
  offices: Office[] | EnrichedOffice[];
  sourceUrl?: string;
  fetchedAt?: string;
}

export interface SaveOfficesResult {
  jsonPath: string;
  csvPath: string;
}

/**
 * Сохраняет итоговые данные в JSON и CSV.
 *
 * JSON — полный объект (включая sourceUrl/fetchedAt/count).
 * CSV — плоская таблица с BOM (\uFEFF), чтобы корректно открывалась в Excel.
 */
export async function saveOffices(
  data: SaveOfficesData,
  options: SaveOfficesOptions = {},
): Promise<SaveOfficesResult> {
  const dir = options.dir ?? "output";
  const basename = options.basename ?? "offices";

  await mkdir(dir, { recursive: true });
  const jsonPath = join(dir, `${basename}.json`);
  const csvPath = join(dir, `${basename}.csv`);

  await writeFile(
    jsonPath,
    JSON.stringify({ ...data, count: data.offices.length }, null, 2) + "\n",
    "utf8",
  );
  await writeFile(csvPath, `\uFEFF${toCsv(data.offices)}`, "utf8");

  return { jsonPath, csvPath };
}