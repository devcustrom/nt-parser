import { test } from "node:test";
import assert from "node:assert/strict";

import { parseOffices } from "../dist/esm/index.js";

/**
 * Имитирует сериализацию Next.js RSC: JSON-массив офисов вкладывается
 * в JS-строку flight-payload, где все `\` и `"` экранируются.
 */
function toRscPayload(officesJson) {
  const escaped = officesJson
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `<script>self.__next_f.push([1,"[…,{\\"offices\\":${escaped},\\"searchPlaceholder\\":\\"Введите улицу или город\\"}…"])</script>`;
}

const OFFICES = [
  {
    id: 397,
    code: "PRO294",
    city: "Зугрэс",
    address: 'г. Зугрэс, ул. "Рыночная", д. 1',
    latitude: 48.007439,
    longitude: 38.266677,
    workingHours: "Пн-Вс 09:00-18:00",
    phone: "7 (495) 788-56-93",
    email: "nt@tvzgo.ru",
  },
  {
    id: 396,
    code: "PRO293",
    city: "Макеевка",
    address: "г. Макеевка, пр. Ленина, д. 5",
    latitude: 48.0456,
    longitude: 37.925,
    workingHours: "Пн-Вс 09:00-18:00",
    phone: "7 (495) 788-56-93",
    email: "nt@tvzgo.ru",
  },
];

const html = toRscPayload(JSON.stringify(OFFICES).replace(/\n/g, ""));

test("parseOffices извлекает все ПВЗ из html", () => {
  const offices = parseOffices(html);
  assert.equal(offices.length, 2);
  assert.deepEqual(offices, OFFICES);
});

test("parseOffices сохраняет кавычки внутри адреса", () => {
  const offices = parseOffices(html);
  assert.equal(offices[0].address, 'г. Зугрэс, ул. "Рыночная", д. 1');
});

test("parseOffices обрабатывает обычную (неэкранированную) разметку", () => {
  const plain = `<div>{"offices":[${JSON.stringify(OFFICES[0])}]}</div>`;
  const offices = parseOffices(plain);
  assert.equal(offices.length, 1);
  assert.equal(offices[0].code, "PRO294");
});

test("parseOffices бросает ошибку, если данных нет", () => {
  assert.throws(() => parseOffices("<html></html>"), /Не удалось найти данные/);
});