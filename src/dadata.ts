import { Client } from "./generated/client/index.js";
import {
  type SuggestionAddress,
  geoLocateAddress,
  suggestAddress,
} from "./generated/index.js";
import type {
  DadataAddressInfo,
  EnrichDadataOptions,
  EnrichedOffice,
} from "./types.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RADIUS_METERS = 1000;

function toNum(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

function mapSuggestion(
  suggestion: SuggestionAddress | undefined,
): DadataAddressInfo | null {
  if (!suggestion || !suggestion.data) {
    return null;
  }
  const d = suggestion.data;
  const raw = suggestion.data as unknown as Record<string, unknown>;
  return {
    result: suggestion.unrestricted_value ?? suggestion.value ?? undefined,
    region: d.region ?? undefined,
    city: d.city ?? undefined,
    settlement: d.settlement ?? undefined,
    street: d.street ?? undefined,
    house: d.house ?? undefined,
    block: d.block ?? undefined,
    geoLat: toNum(d.geo_lat),
    geoLon: toNum(d.geo_lon),
    qc: (d.qc ?? raw.qc_check ?? undefined) as string | undefined,
    qcComplete: toNum(d.qc_complete),
    qcHouse: toNum(d.qc_house),
    fiasId: d.fias_id ?? undefined,
    timezone: d.timezone ?? undefined,
    raw: suggestion,
  };
}

const CLEANER_URL = "https://cleaner.dadata.ru/api/v1/clean/address";

/** Ответ Cleaner API (стандартизация адреса). */
interface CleanerAddress {
  result?: string | null;
  region?: string | null;
  city?: string | null;
  settlement?: string | null;
  street?: string | null;
  house?: string | null;
  block?: string | null;
  geo_lat?: number | string | null;
  geo_lon?: number | string | null;
  qc?: number | string | null;
  qc_complete?: number | string | null;
  qc_house?: number | string | null;
  fias_id?: string | null;
  timezone?: string | null;
}

function mapCleanerAddress(
  cleaned: CleanerAddress | undefined,
): DadataAddressInfo | null {
  if (!cleaned || !cleaned.result) {
    return null;
  }
  return {
    result: cleaned.result ?? undefined,
    region: cleaned.region ?? undefined,
    city: cleaned.city ?? undefined,
    settlement: cleaned.settlement ?? undefined,
    street: cleaned.street ?? undefined,
    house: cleaned.house ?? undefined,
    block: cleaned.block ?? undefined,
    geoLat: toNum(cleaned.geo_lat),
    geoLon: toNum(cleaned.geo_lon),
    qc: cleaned.qc != null ? String(cleaned.qc) : undefined,
    qcComplete: toNum(cleaned.qc_complete),
    qcHouse: toNum(cleaned.qc_house),
    fiasId: cleaned.fias_id ?? undefined,
    timezone: cleaned.timezone ?? undefined,
    raw: cleaned as unknown as Record<string, unknown>,
  };
}

/**
 * Стандартизация адреса через Cleaner API Dadata
 * (`cleaner.dadata.ru/api/v1/clean/address`). В отличие от подсказок требует
 * и API-ключ, и секретный ключ. Возвращает нормализованный адрес либо `null`.
 */
async function cleanAddressWithDadata(
  query: string,
  apiKey: string,
  secretKey: string,
  httpFetch: typeof globalThis.fetch,
): Promise<DadataAddressInfo | null> {
  const response = await httpFetch(CLEANER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Token ${apiKey}`,
      "x-secret": secretKey,
    },
    body: JSON.stringify([query]),
  });

  if (!response.ok) {
    throw new Error(
      `Cleaner API: HTTP ${response.status} при запросе ${CLEANER_URL}`,
    );
  }

  const data = (await response.json()) as CleanerAddress[];
  return mapCleanerAddress(data?.[0]);
}

/** Слова, после которых точка не завершает предложение (пер., г., обл.). */
const ADDRESS_ABBR = new Set(
  ("г|гор|город|обл|область|пер|переулок|ул|улица|пр|пр-кт|пр-т|просп|" +
    "проспект|р-н|район|пос|поселок|пгт|с|село|д|дом|стр|строение|корп|" +
    "корпус|к|кв|ш|шоссе|наб|набережная|пл|площадь|б-р|бульвар|мкр|" +
    "микрорайон|тер").split("|"),
);

const WORD_PERIOD_RE = /([A-Za-zА-Яа-яЁё-]+)\.\s/g;

/**
 * Делит текст на предложения по точке, не разрывая адресные аббревиатуры
 * (`пер. Почтовый`, `г. Донецк`). Обычный `\b` не подходит — в JS он не
 * учитывает кириллицу.
 */
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  WORD_PERIOD_RE.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = WORD_PERIOD_RE.exec(text))) {
    if (ADDRESS_ABBR.has(match[1].toLowerCase())) {
      continue;
    }
    const end = match.index + match[1].length + 1;
    parts.push(text.slice(last, end));
    last = match.index + match[0].length;
  }

  parts.push(text.slice(last));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Начинается ли фраза с типа адресного объекта (пер, ул, г, …). */
const TYPE_PREFIX_RE =
  /^(?:г|гор|город|пос|поселок|пгт|село|деревня|снт|ул|улица|пер|переулок|пр-кт|пр-т|просп|проспект|ш|шоссе|наб|набережная|б-р|бульвар|пл|площадь|обл|область|р-н|район|край|респ|республика|мкр|микрорайон|тер)[.\s]/i;

/** Убирает примечания в скобках и нормализует пробелы/пунктуацию. */
function cleanAddress(input: string): string {
  return input
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/^[\s,;]+/g, "")
    .replace(/[,.;\s]+$/g, "")
    .trim();
}

/** Обрезает хвостовую пунктуацию, сохраняя точку после сокращений (обл., пер.). */
function trimClause(clause: string): string {
  const stripped = clause.replace(/[.\s]+$/g, "");
  const last = stripped.match(/([A-Za-zА-Яа-яЁё-]+)$/);
  if (last && ADDRESS_ABBR.has(last[1].toLowerCase())) {
    return stripped + ".";
  }
  return stripped;
}

/**
 * Строит более короткий запрос для Dadata: обрезает пояснения после
 * двоеточия и отбрасывает «не-адресные» части (например,
 * «Поселок имеет 3 названия: …»), оставляя адресную составляющую.
 */
function dropNoteClauses(input: string): string {
  const clauses = input.split(/,\s*/);
  const kept: string[] = [];

  for (let clause of clauses) {
    const head = clause.split(/:\s*/)[0];
    const sentences = splitSentences(head);

    if (sentences.length > 1) {
      const keptSentences = [sentences[0]];
      for (const sentence of sentences.slice(1)) {
        const words = sentence.split(/\s+/).filter(Boolean).length;
        if (TYPE_PREFIX_RE.test(sentence) && words <= 3) {
          keptSentences.push(sentence);
        }
      }
      clause = keptSentences.join(". ");
    }

    kept.push(trimClause(clause));
  }

  return cleanAddress(kept.join(", "));
}

/** Варианты запроса: без скобок и без пояснений. */
function buildQueries(original: string): string[] {
  const queries: string[] = [];
  const cleaned = cleanAddress(original);
  if (cleaned && cleaned !== original) {
    queries.push(cleaned);
  }
  const trimmed = cleanAddress(dropNoteClauses(cleaned));
  if (trimmed && trimmed !== original && !queries.includes(trimmed)) {
    queries.push(trimmed);
  }
  return queries;
}

/**
 * Обогащает ПВЗ данными через Dadata. Для каждого адреса проверки идут по
 * порядку, результат первой успешной добавляется как `dadata`:
 *
 * 1. подсказки по строке адреса (`suggest/address`);
 * 2. геопривязка по координатам ПВЗ (`geoLocate/address`);
 * 3. стандартизация через Cleaner API (`clean/address`) — требует и
 *    `apiKey`, и `secretKey`;
 * 4. при отсутствии `secretKey` вместо шага 3 — повторные `suggest/address`
 *    с адресом, очищенным от мусора (скобки, примечания).
 *
 * Порядок офисов сохраняется. Записи, у которых уже есть поле `dadata`,
 * пропускаются без запросов к Dadata. Если ни одна проверка не дала
 * результата — запись остаётся без поля `dadata`.
 */
export async function enrichOfficesWithDadata(
  offices: readonly EnrichedOffice[],
  options: EnrichDadataOptions = {},
): Promise<EnrichedOffice[]> {
  const {
    apiKey,
    secretKey,
    concurrency = DEFAULT_CONCURRENCY,
    radiusMeters = DEFAULT_RADIUS_METERS,
    client,
  } = options;

  const headers: Record<string, string> | undefined = apiKey
    ? { authorization: `Token ${apiKey}` }
    : undefined;

  const httpFetch =
    (client?.getConfig().fetch as typeof globalThis.fetch | undefined) ??
    globalThis.fetch;

  const results: Array<DadataAddressInfo | null> = new Array(offices.length).fill(null);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < offices.length) {
      const index = cursor++;
      const office = offices[index];

      // Уже обогащённые записи не трогаем — экономим запросы к Dadata.
      if (office.dadata) {
        results[index] = office.dadata;
        continue;
      }

      // Проверка №1 — подсказки по строке адреса.
      const response = await suggestAddress<true>({
        body: { query: office.address, count: 1 },
        headers,
        client,
        throwOnError: true,
      });
      let info = mapSuggestion(response.data.suggestions?.[0]);

      // Проверка №2 — геопривязка по координатам ПВЗ.
      if (
        !info &&
        typeof office.latitude === "number" &&
        typeof office.longitude === "number"
      ) {
        const geo = await geoLocateAddress<true>({
          body: {
            lat: office.latitude,
            lon: office.longitude,
            count: 1,
            radius_meters: radiusMeters,
          },
          headers,
          client,
          throwOnError: true,
        });
        info = mapSuggestion(geo.data.suggestions?.[0]);
      }

      // Проверка №3 — стандартизация через Cleaner API (оба ключа).
      if (!info && apiKey && secretKey) {
        info = await cleanAddressWithDadata(
          office.address,
          apiKey,
          secretKey,
          httpFetch,
        );
      }

      // Проверка №4 — нет секретного ключа: повторные подсказки по адресу,
      // очищенному от мусора (скобки, примечания вроде «имеет 3 названия: …»).
      if (!info && !secretKey) {
        for (const query of buildQueries(office.address)) {
          const retry = await suggestAddress<true>({
            body: { query, count: 1 },
            headers,
            client,
            throwOnError: true,
          });
          info = mapSuggestion(retry.data.suggestions?.[0]);
          if (info) {
            break;
          }
        }
      }

      results[index] = info;
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, offices.length) },
    worker,
  );
  await Promise.all(workers);

  return offices.map((office, i) => {
    const dadata = results[i];
    return dadata ? { ...office, dadata } : office;
  });
}