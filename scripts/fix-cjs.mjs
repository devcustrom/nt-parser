import { writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const cjsDir = join(root, "dist", "cjs");
mkdirSync(cjsDir, { recursive: true });
writeFileSync(
  join(cjsDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);

// Декларации `.d.ts` из исходников не попадают в outDir автоматически.
// Копируем их, чтобы потребители получили типы (например, ambient-модуль "dadata").
for (const sub of ["esm", "cjs"]) {
  for (const file of readdirSync(join(root, "src")).filter((f) => f.endsWith(".d.ts"))) {
    copyFileSync(join(root, "src", file), join(root, "dist", sub, file));
  }
}