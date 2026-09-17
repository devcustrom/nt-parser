import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { saveOffices, toCsv } from "../dist/esm/index.js";

const OFFICES = [
  {
    id: 1,
    code: "PRO1",
    city: "Донецк",
    address: "г. Донецк, ул. Ленина, д. 1",
    latitude: 48.0,
    longitude: 37.8,
    workingHours: "Пн-Вс 09:00-18:00",
    phone: "7 (495) 788-56-93",
    email: "nt@tvzgo.ru",
  },
  {
    id: 2,
    code: "PRO2",
    city: "Макеевка",
    address: 'г. Макеевка, ул. "Горького", д. 5',
    latitude: 48.04,
    longitude: 37.92,
    workingHours: "Пн-Вс 09:00-18:00",
    phone: "7 (495) 788-56-93",
    email: "nt@tvzgo.ru",
  },
];

test("toCsv: заголовки и экранирование", () => {
  const csv = toCsv(OFFICES);
  assert.ok(csv.startsWith("id,code,city,address,latitude,longitude"));

  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  // адрес с кавычками экранируется
  assert.ok(lines[2].includes('"г. Макеевка, ул. ""Горького"", д. 5"'));
});

test("toCsv: добавляет колонки dadata только если есть обогащение", () => {
  const enriched = OFFICES.map((office) => ({ ...office, dadata: { result: "р", region: "ДОН" } }));
  const csv = toCsv(enriched);
  assert.ok(csv.includes("dadata_result,dadata_region"));
  assert.ok(csv.includes("ДОН"));

  const plain = toCsv(OFFICES);
  assert.ok(!plain.includes("dadata_"));
});

test("saveOffices: пишет JSON и CSV с BOM", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nt-parser-"));

  const { jsonPath, csvPath } = await saveOffices(
    { offices: OFFICES, sourceUrl: "https://tvzgo.ru", fetchedAt: "2026-01-01T00:00:00.000Z" },
    { dir },
  );

  assert.equal(jsonPath, join(dir, "offices.json"));
  assert.equal(csvPath, join(dir, "offices.csv"));

  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(json.count, 2);
  assert.equal(json.offices.length, 2);
  assert.equal(json.sourceUrl, "https://tvzgo.ru");

  const csv = readFileSync(csvPath, "utf8");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("id,code,city"));
});