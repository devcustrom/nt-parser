import type {
  FetchAndEnrichOptions,
  FetchOfficesResult,
  FetchOptions,
  Office,
} from "./types.js";
import { enrichOfficesWithDadata } from "./dadata.js";

export * from "./dadata.js";
export * from "./csv.js";
export type * from "./types.js";

export {
  geoLocateAddress,
  suggestAddress,
} from "./generated/index.js";
export { client as dadataClient } from "./generated/client.gen.js";
export type {
  Address as DadataAddress,
  SuggestAddressResponse,
  SuggestionAddress,
} from "./generated/index.js";

export const DEFAULT_BASE_URL = "https://tvzgo.ru";

/**
 * Единый regex для поиска начала массива ПВЗ. Одна схема покрывает оба
 * варианта разметки: экранированную внутри JS-строки flight-payload
 * (`\"offices\":[`) и обычную (`"offices":[`).
 *
 * Группы: 1 — бэкслеш перед открывающей кавычкой, 2 — перед закрывающей.
 * Наличие любой из них означает, что data внедрена в JS-строку.
 */
const OFFICES_MARKER_RE = /(\\?)"offices(\\?)"\s*:\s*\[/;

interface Marker {
  /** Позиция открывающей скобки `[` массива ПВЗ. */
  start: number;
  /** true, если массив встроен в JS-строку flight-payload (кавычки вида `\"`). */
  jsEscaped: boolean;
}

function findMarker(html: string): Marker {
  const match = OFFICES_MARKER_RE.exec(html);
  if (!match) {
    throw new Error("Не удалось найти данные о ПВЗ на странице");
  }
  return {
    start: match.index + match[0].length - 1,
    jsEscaped: Boolean(match[1] || match[2]),
  };
}

/** Токены, значимые для разбора: `\`, `"`, `[`, `]`. */
const JSON_TOKEN_RE = /[\\"[\]]/g;

function findMatchingBracket(source: string, openIndex: number): number {
  JSON_TOKEN_RE.lastIndex = openIndex;
  let depth = 0;
  let inString = false;

  for (let match = JSON_TOKEN_RE.exec(source); match; match = JSON_TOKEN_RE.exec(source)) {
    const token = match[0];

    if (token === "\\") {
      // пропускаем экранированный символ (например, `\"`)
      JSON_TOKEN_RE.lastIndex = match.index + 2;
    } else if (token === '"') {
      inString = !inString;
    } else if (!inString && token === "[") {
      depth++;
    } else if (!inString && token === "]") {
      depth--;
      if (depth === 0) {
        return match.index;
      }
    }
  }

  throw new Error("Не удалось найти конец массива ПВЗ на странице");
}

/**
 * Разэкранирует содержимое JS-строки. `input` — текст, лежащий внутри
 * двойных кавычек, поэтому обёртка `"${input}"` даёт валидный JSON-string
 * литерал, а `JSON.parse` сам раскрывает все стандартные escape-последовательности
 * (`\"`, `\\`, `\n`, `\uXXXX` и т.д.).
 */
function unescapeJsString(input: string): string {
  return JSON.parse(`"${input}"`) as string;
}

/**
 * Извлекает массив ПВЗ из HTML-разметки главной страницы tvzgo.ru.
 *
 * Сайт построен на Next.js (React Server Components): массив офисов
 * сериализуется сервером прямо в HTML внутри payload-строк, поэтому
 * отдельного API-запроса не требуется. Кавычки в payload экранированы
 * как `\"`, как в обычной JS-строке.
 */
export function parseOffices(html: string): Office[] {
  const { start, jsEscaped } = findMarker(html);
  const arrayEnd = findMatchingBracket(html, start);
  const raw = html.slice(start, arrayEnd + 1);
  const json = jsEscaped ? unescapeJsString(raw) : raw;

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`Не удалось разобрать данные о ПВЗ: ${String(err)}`);
  }

  if (!Array.isArray(data)) {
    throw new Error("Данные о ПВЗ имеют неожиданный формат");
  }

  return data as Office[];
}

/**
 * Загружает и разбирает список ПВЗ с tvzgo.ru.
 *
 * Возвращает массив офисов, а также метаданные: ссылку на источник и
 * дату получения данных.
 */
export async function fetchOffices(
  options: FetchOptions = {},
): Promise<FetchOfficesResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const httpFetch = options.fetch ?? globalThis.fetch;

  const response = await httpFetch(baseUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "nt-parser/0.1 (+https://www.npmjs.com/package/nt-parser)",
      accept: "text/html",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка HTTP ${response.status} при запросе ${baseUrl}`);
  }

  const html = await response.text();
  const offices = parseOffices(html);

  return {
    offices,
    sourceUrl: baseUrl,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Загружает ПВЗ с tvzgo.ru и обогащает их данными Dadata за один вызов.
 * Требует `options.dadata.apiKey`.
 */
export async function fetchAndEnrichOffices(
  options: FetchAndEnrichOptions,
): Promise<FetchOfficesResult> {
  const { dadata, ...fetchOptions } = options;
  const result = await fetchOffices(fetchOptions);
  const offices = await enrichOfficesWithDadata(result.offices, dadata);
  return { ...result, offices };
}