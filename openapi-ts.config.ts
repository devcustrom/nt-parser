import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "https://dadata.ru/files/openapi/suggestions.yml",
  output: {
    path: "src/generated",
    postProcess: ["prettier"],
    clean: true,
  },
  plugins: [
    "@hey-api/client-fetch",
    "@hey-api/sdk",
    "@hey-api/typescript",
    "@hey-api/transformers",
  ],
});