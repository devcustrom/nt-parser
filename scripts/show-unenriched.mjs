import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const inputPath = resolve(process.argv[2] ?? "output/offices.json");

let data;
try {
  data = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (err) {
  console.error(`Не удалось прочитать ${inputPath}: ${String(err)}`);
  process.exit(1);
}

const offices = Array.isArray(data) ? data : data.offices;

if (!Array.isArray(offices)) {
  console.error("В файле нет массива ПВЗ");
  process.exit(1);
}

const unenriched = offices.filter((office) => !office.dadata);

console.log(`Всего ПВЗ: ${offices.length}`);
console.log(`Не обогащено: ${unenriched.length}`);
console.log();

for (const office of unenriched) {
  console.log(`- ${office.code} | ${office.city} | ${office.address}`);
}

if (unenriched.length > 0) {
  const ids = unenriched.map((office) => office.id).join(", ");
  console.log();
  console.log(`ID: ${ids}`);
}