/** Строка с часами работы ПВЗ, например `«Пн-Вс 09:00-18:00»`. */
export interface Office {
  /** Внутренний идентификатор в базе сайта. */
  id: number;
  /** Внутренний код ПВЗ, например `PRO294`. */
  code: string;
  /** Город или регион. */
  city: string;
  /** Полный адрес. */
  address: string;
  /** Широта. */
  latitude: number;
  /** Долгота. */
  longitude: number;
  /** Часы работы. */
  workingHours: string;
  /** Телефон контактной службы. */
  phone: string;
  /** Email контактной службы. */
  email: string;
}

export interface FetchOptions {
  /** Базовый адрес сайта. По умолчанию `https://tvzgo.ru`. */
  baseUrl?: string;
  /** Дополнительные заголовки для запроса. */
  headers?: Record<string, string>;
  /** HTTP-клиент, совместимый с `fetch`. По умолчанию глобальный `fetch`. */
  fetch?: typeof globalThis.fetch;
}

export interface FetchOfficesResult {
  /** Список ПВЗ. */
  offices: Office[];
  /** Ссылка на страницу, с которой получены данные. */
  sourceUrl: string;
  /** Время получения данных (RFC 3339). */
  fetchedAt: string;
}

/** Нормализованный адрес из Dadata. */
export interface DadataAddressInfo {
  /** Нормализованный адрес целиком. */
  result?: string;
  region?: string;
  city?: string;
  settlement?: string;
  street?: string;
  house?: string;
  block?: string;
  geoLat?: number;
  geoLon?: number;
  /** Код качества адреса (строка от Dadata, например "0"). */
  qc?: string;
  qcComplete?: number;
  qcHouse?: number;
  fiasId?: string;
  timezone?: string;
  /** Сырой ответ Dadata для записи. */
  raw?: Record<string, unknown>;
}

/** ПВЗ с обогащёнными данными из Dadata. */
export interface EnrichedOffice extends Office {
  dadata?: DadataAddressInfo;
}

import type { Client } from "./generated/client/index.js";

export interface EnrichDadataOptions {
  /**
   * API-ключ Dadata. Подставляется в заголовок `Authorization: Token ...`
   * для каждого запроса. Если не передан — ключ должен быть задан извне
   * через экспортированный `dadataClient.setConfig({ headers })`.
   */
  apiKey?: string;
  /**
   * Секретный ключ Dadata, требуется только для третьего шага обогащения —
   * стандартизации через Cleaner API (`clean/address`). Если не передан,
   * шаг пропускается.
   */
  secretKey?: string;
  /** Максимум одновременных запросов к Dadata. По умолчанию 4. */
  concurrency?: number;
  /** Пользовательский клиент SDK (для тестов). */
  client?: Client;
  /**
   * Радиус поиска в метрах для fallback-геопривязки по координатам ПВЗ,
   * если по адресу подсказки не нашлось. По умолчанию 1000.
   */
  radiusMeters?: number;
}

export interface FetchAndEnrichOptions extends FetchOptions {
  /** Настройки обогащения через Dadata. */
  dadata: EnrichDadataOptions;
}