import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  enrichOfficesWithDadata,
  fetchAndEnrichOffices,
  dadataClient,
} from "../dist/esm/index.js";

import { createClient } from "../dist/esm/generated/client/index.js";

const OFFICE = {
  id: 1,
  code: "PRO1",
  city: "Донецк",
  address: "г. Донецк, ул. Ленина, д. 1",
  latitude: 48.0,
  longitude: 37.8,
  workingHours: "Пн-Вс 09:00-18:00",
  phone: "7 (495) 788-56-93",
  email: "nt@vtzgo.ru",
};

function suggestionData(address) {
  return {
    region: "Донецкая область",
    city: "Донецк",
    street: "ул. Ленина",
    house: "1",
    geo_lat: "48.0158",
    geo_lon: "37.8028",
    qc: "0",
    qc_complete: "0",
    fias_id: "abc-1",
    timezone: "Europe/Moscow",
  };
}

/**
 * Creates a mock fetch function compatible with the hey-api client.
 * The returned function can be called as `fetch(input, init?)` where:
 *   - input: string (url) or Request-like object
 *   - init: optional init object (used if input is string)
 * It extracts the effective method, url, headers, body and routes to
 * either the homepage or suggestion handler.
 */
function makeFetch(suggestCallback, homepageHtml = "", cleanCallback = null) {
  const calls = [];
  const fetch = async (input, init) => {
    // Normalize input to get url, method, headers, body
    let url, method = "GET", headers = new Headers(), body = null;
    if (typeof input === "string") {
      url = input;
      if (init) {
        if (init.method) method = init.method;
        if (init.headers) {
          // init.headers may be Headers object or plain object; convert to Headers
          const hdr = init.headers;
          if (hdr instanceof Headers) {
            for (const [k, v] of hdr) {
              headers.append(k, v);
            }
          } else {
            for (const [k, v] of Object.entries(hdr)) {
              headers.append(k, v);
            }
          }
        }
        if (init.body !== undefined) body = init.body;
      }
    } else if (
      input !== null &&
      typeof input === "object" &&
      "url" in input &&
      "method" in input
    ) {
      // input is a Request instance used by the hey-api client
      url = input.url;
      method = input.method;
      if (input.headers) {
        const hdr = input.headers;
        if (hdr instanceof Headers) {
          for (const [k, v] of hdr) {
            headers.append(k, v);
          }
        } else {
          for (const [k, v] of Object.entries(hdr)) {
            headers.append(k, v);
          }
        }
      }
      body = input.body;
    } else {
      throw new TypeError("fetch: unsupported input");
    }

    // Materialize streaming body (ReadableStream from Request) to text
    if (body !== null && typeof body === "object" && typeof body.getReader === "function") {
      body = await new Response(body).text();
    }
    calls.push({ url, method, headers, body });

    if (url === "https://tvzgo.ru") {
      return new MockResponse(
        true,
        200,
        false,
        homepageHtml,
        { "content-type": "text/html" }
      );
    }
    // suggestion / geolocation / cleaner request: expect POST with json body
    if (method === "POST" && headers.get("content-type") === "application/json") {
      let reqBody = null;
      if (typeof body === "string") {
        try {
          reqBody = JSON.parse(body);
        } catch (_) {}
      } else if (body !== null) {
        reqBody = body;
      }

      // Cleaner API: тело — массив строк, ответ — массив объектов.
      if (Array.isArray(reqBody)) {
        const query = reqBody[0] ?? "";
        const cleaned = cleanCallback ? cleanCallback(query) : [];
        return new MockResponse(
          true,
          200,
          false,
          cleaned,
          { "content-type": "application/json" }
        );
      }

      const query = (reqBody && typeof reqBody === "object" && reqBody.query) ?? "";
      const suggestions = suggestCallback(query);
      const respBody = { suggestions };
      return new MockResponse(
        true,
        200,
        false,
        respBody,
        { "content-type": "application/json" }
      );
    }
    // fallback
    return new MockResponse(
      true,
      200,
      false,
      {},
      { "content-type": "application/json" }
    );
  };
  return { fetch, calls };
}

class MockResponse {
  constructor(ok, status, redirected, body, headersInit = {}) {
    this.ok = ok;
    this.status = status;
    this.redirected = redirected;
    this.body = body;
    this.headers = new Headers(headersInit);
  }
  async text() {
    if (typeof this.body === "string") return this.body;
    if (this.body instanceof Blob) return this.body.text();
    return JSON.stringify(this.body);
  }
  async json() {
    if (typeof this.body === "string") return JSON.parse(this.body);
    return this.body;
  }
  clone() {
    return new MockResponse(
      this.ok,
      this.status,
      this.redirected,
      this.body,
      Object.fromEntries(this.headers)
    );
  }
}

afterEach(() => {
  dadataClient.setConfig({ headers: {} });
});

test("apiKey → заголовок Authorization передаётся в запросах", async () => {
  const { fetch, calls } = makeFetch(() => [
    { value: "г Донецк", unrestricted_value: "г Донецк", data: suggestionData("") },
  ]);

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const enriched = await enrichOfficesWithDadata([OFFICE], {
    apiKey: "my-api-key",
    client: customClient,
  });

  assert.equal(calls.length, 1);
  const call = calls[0];
  const auth = call.headers.get?.("authorization");
  assert.equal(auth, "Token my-api-key");
  assert.equal(enriched.length, 1);
  assert.ok(enriched[0].dadata);
});

test("без apiKey используется клиент, настроенный извне", async () => {
  const { fetch, calls } = makeFetch(() => [
    { value: "ок", unrestricted_value: "ок", data: suggestionData("") },
  ]);

  // Use a custom client with the desired headers, baseUrl, and fetch
  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    headers: { authorization: "Token external-key" },
    fetch,
  });

  const enriched = await enrichOfficesWithDadata([OFFICE], { client: customClient });

  assert.equal(calls.length, 1);
  const auth = calls[0].headers.get?.("authorization");
  assert.equal(auth, "Token external-key");
  assert.ok(enriched[0].dadata);
});

test("мапит suggestion: строковые координаты → число, null пропускается", async () => {
  const offices = [OFFICE, OFFICE, OFFICE];
  const { fetch } = makeFetch(() => [
    { value: "г Донецк", unrestricted_value: "г Донецк", data: suggestionData("") },
  ]);

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const enriched = await enrichOfficesWithDadata(offices, {
    apiKey: "key",
    concurrency: 2,
    client: customClient,
  });

  assert.equal(enriched.length, 3);
  assert.equal(enriched[0].dadata.geoLat, 48.0158);
  assert.equal(enriched[0].dadata.geoLon, 37.8028);
  assert.equal(enriched[0].dadata.qc, "0");
  assert.equal(enriched[0].dadata.region, "Донецкая область");
  assert.equal(enriched[0].dadata.fiasId, "abc-1");
});

test("подсказки нет → dadata отсутствует", async () => {
  const { fetch } = makeFetch(() => []);

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const enriched = await enrichOfficesWithDadata([OFFICE], {
    apiKey: "key",
    client: customClient,
  });

  assert.equal(enriched[0].dadata, undefined);
});

test("адрес не найден → fallback по координатам (geoLocate)", async () => {
  const { fetch, calls } = makeFetch((query) =>
    query
      ? []
      : [
          {
            value: "г Донецк",
            unrestricted_value: "г Донецк",
            data: suggestionData(""),
          },
        ]
  );

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const enriched = await enrichOfficesWithDadata([OFFICE], {
    apiKey: "key",
    client: customClient,
  });

  assert.equal(calls.length, 2);

  const suggestCall = calls[0];
  const geoCall = calls[1];
  assert.match(suggestCall.url, /\/rs\/suggest\/address$/);
  assert.match(geoCall.url, /\/rs\/geolocate\/address$/);

  const geoBody = JSON.parse(geoCall.body);
  assert.equal(geoBody.lat, OFFICE.latitude);
  assert.equal(geoBody.lon, OFFICE.longitude);
  assert.equal(geoBody.radius_meters, 1000);

  assert.equal(enriched[0].dadata.geoLat, 48.0158);
  assert.equal(enriched[0].dadata.city, "Донецк");
});

test("fallback: radius_meters из опций", async () => {
  const { fetch, calls } = makeFetch((query) =>
    query ? [] : [{ value: "ок", unrestricted_value: "ок", data: suggestionData("") }]
  );

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const enriched = await enrichOfficesWithDadata([OFFICE], {
    apiKey: "key",
    radiusMeters: 5000,
    client: customClient,
  });

  assert.equal(calls.length, 2);
  const geoBody = JSON.parse(calls[1].body);
  assert.equal(geoBody.radius_meters, 5000);
  assert.ok(enriched[0].dadata);
});

test("уже обогащённые ПВЗ пропускаются без запроса к Dadata", async () => {
  const alreadyEnriched = {
    ...OFFICE,
    dadata: { result: "г Донецк", city: "Донецк", geoLat: 48.0, geoLon: 37.8 },
  };

  const { fetch, calls } = makeFetch(() => [
    { value: "ок", unrestricted_value: "ок", data: suggestionData("") },
  ]);

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const enriched = await enrichOfficesWithDadata([alreadyEnriched, OFFICE], {
    apiKey: "key",
    client: customClient,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(enriched[0], alreadyEnriched);
  assert.equal(enriched[1].dadata.city, "Донецк");
});

test("мусорный адрес → Cleaner API (третья проверка)", async () => {
  const messyOffice = {
    ...OFFICE,
    address:
      "Запорожская обл., ПГТ Каменка. Поселок имеет 3 названия: КУЙБЫШЕВО (Бельмак) ( Каменка), пер. Почтовый, 27В",
  };

  const { fetch, calls } = makeFetch(
    () => [],
    "",
    (query) => [
      {
        result: "Запорожская обл., ПГТ Каменка, пер. Почтовый, 27В",
        region: "Запорожская область",
        city: "Каменка-Днепровская",
        street: "пер. Почтовый",
        house: "27В",
        geo_lat: "47.361583",
        geo_lon: "36.648673",
        qc: "0",
        fias_id: "cleaner-fias-1",
        timezone: "Europe/Zaporozhye",
      },
    ]
  );

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const enriched = await enrichOfficesWithDadata([messyOffice], {
    apiKey: "key",
    secretKey: "secret",
    client: customClient,
  });

  // 1) suggest по строке, 2) geoLocate по координатам, 3) clean/address.
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/rs\/suggest\/address$/);
  assert.match(calls[1].url, /\/rs\/geolocate\/address$/);
  assert.match(calls[2].url, /\/clean\/address$/);

  const cleanerCall = calls[2];
  const cleanerBody = JSON.parse(cleanerCall.body);
  assert.deepEqual(cleanerBody, [messyOffice.address]);
  assert.equal(cleanerCall.headers.get("authorization"), "Token key");
  assert.equal(cleanerCall.headers.get("x-secret"), "secret");

  assert.ok(enriched[0].dadata);
  assert.equal(enriched[0].dadata.result, "Запорожская обл., ПГТ Каменка, пер. Почтовый, 27В");
  assert.equal(enriched[0].dadata.geoLat, 47.361583);
  assert.equal(enriched[0].dadata.city, "Каменка-Днепровская");
  assert.equal(enriched[0].dadata.fiasId, "cleaner-fias-1");
});

test("мусорный адрес без secretKey → 4-й fallback по очищенному запросу", async () => {
  const messyOffice = {
    ...OFFICE,
    address:
      "Запорожская обл., ПГТ Каменка. Поселок имеет 3 названия: КУЙБЫШЕВО (Бельмак) ( Каменка), пер. Почтовый, 27В",
  };
  const cleanQuery = "Запорожская обл., ПГТ Каменка, пер. Почтовый, 27В";

  const { fetch, calls } = makeFetch((query) =>
    query === cleanQuery
      ? [{ value: "ок", unrestricted_value: "ок", data: suggestionData("") }]
      : []
  );

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const enriched = await enrichOfficesWithDadata([messyOffice], {
    apiKey: "key",
    client: customClient,
  });

  // 1) suggest по исходному адресу, 2) geoLocate,
  // 3–4) suggest по очищенным вариантам (последний нашёл подсказку).
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /\/rs\/suggest\/address$/);
  assert.match(calls[1].url, /\/rs\/geolocate\/address$/);
  assert.match(calls[2].url, /\/rs\/suggest\/address$/);
  assert.match(calls[3].url, /\/rs\/suggest\/address$/);
  assert.equal(JSON.parse(calls[3].body).query, cleanQuery);
  assert.ok(!calls.some((call) => call.url.includes("/clean/address")));
  assert.ok(enriched[0].dadata);
  assert.equal(enriched[0].dadata.city, "Донецк");
});

test("без secretKey Cleaner не вызывается", async () => {
  const { fetch, calls } = makeFetch(() => []);

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const enriched = await enrichOfficesWithDadata([OFFICE], {
    apiKey: "key",
    client: customClient,
  });

  // suggest + geoLocate (адрес чистый — очищенных запросов нет), без clean/address
  assert.equal(calls.length, 2);
  assert.ok(!calls.some((call) => call.url.includes("/clean/address")));
  assert.equal(enriched[0].dadata, undefined);
});

test("fetchAndEnrich: загрузка с сайта + обогащение одним вызовом", async () => {
  const office = { ...OFFICE, address: "г. Донецк, ул. Ленина, д. 1" };
  const escaped = JSON.stringify([office])
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const html = `<script>self.__next_f.push([1,"…,{\\"offices\\":${escaped}…"])</script>`;

  const { fetch, calls } = makeFetch(
    () => [
      { value: "г Донецк", unrestricted_value: "г Донецк", data: suggestionData("") },
    ],
    html
  );

  const customClient = createClient();
  customClient.setConfig({
    baseUrl: "https://suggestions.dadata.ru/suggestions",
    fetch,
  });

  const result = await fetchAndEnrichOffices({
    dadata: { apiKey: "key", concurrency: 1, client: customClient },
    fetch: fetch,
  });

  assert.equal(result.offices.length, 1);
  assert.equal(result.offices[0].city, "Донецк");
  assert.equal(result.offices[0].dadata.geoLat, 48.0158);
});