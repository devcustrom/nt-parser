# nt-parser

Парсер списка ПВЗ (пунктов выдачи заказов) с сайта [tvzgo.ru](https://tvzgo.ru), с поддержкой обогащения данных через Dadata.

## Установка

```bash
npm install nt-parser
```

## Использование

### Основные функции

#### `fetchOffices(options)`

Загружает список ПВЗ с сайта tvzgo.ru.

```ts
import { fetchOffices } from "nt-parser";

const result = await fetchOffices();
console.log(result.offices.length); // 132
```

#### `enrichOfficesWithDadata(offices, options)`

Обогащает данные ПВЗ через Dadata. Для каждого адреса проверки идут по порядку, используется результат первой успешной:

1. **Подсказки по строке** (`suggest/address`) — достаточно только API-ключа.
2. **Геопривязка по координатам** (`geoLocate/address`) — fallback, если строка не нашлась.
3. **Cleaner API** (`clean/address`) — стандартизация адреса; требует и API-ключ, и секретный ключ.
4. Если `secretKey` не задан — шаг 3 заменяется повторными `suggest/address` с адресом, очищенным от мусора (скобки, примечания вроде «имеет 3 названия: …»).

```ts
import { enrichOfficesWithDadata } from "nt-parser";

const offices = await enrichOfficesWithDadata(rawOffices, {
  apiKey: "ваш_ключ",
  secretKey: "ваш_секрет",           // опционально, для шага 3
  concurrency: 4,
  radiusMeters: 1000
});
```

#### `fetchAndEnrichOffices(options)`

Загружает ПВЗ с сайта и обогащает их данными Dadata за один вызов.

```ts
import { fetchAndEnrichOffices } from "nt-parser";

const result = await fetchAndEnrichOffices({ dadata: { apiKey: "ваш_ключ" } });
```

### Настройка Dadata

Пакет использует [@hey-api/openapi-ts](https://github.com/hey-api/openapi-ts) для генерации клиента из официальной спецификации Dadata Suggestions API (https://dadata.ru/files/openapi/suggestions.yml). Подсказки и геопривязка требуют только API-ключ; для третьего шага (Cleaner API — стандартизация адреса) нужен дополнительный секретный ключ (`secretKey`), а без него включается четвёртый шаг — повторные подсказки по адресу, очищенному от мусора.

#### Через параметры

```ts
import { enrichOfficesWithDadata } from "nt-parser";

const offices = await enrichOfficesWithDadata(rawOffices, {
  apiKey: process.env.DADATA_API_KEY,
  secretKey: process.env.DADATA_SECRET_KEY,   // для Cleaner API (опционально)
  concurrency: 4,
  radiusMeters: 1000
});
```

#### Через клиент

```ts
import { dadataClient, enrichOfficesWithDadata } from "nt-parser";

dadataClient.setConfig({
  headers: { authorization: `Token ${process.env.DADATA_API_KEY}` }
});

const offices = await enrichOfficesWithDadata(rawOffices, {
  secretKey: process.env.DADATA_SECRET_KEY
});
```

### Утилиты сохранения

#### `toCsv(offices)`

Формирует CSV с заголовками, корректным экранированием (RFC 4180) и поддерживает добавление колонок Dadata только если есть обогащённые данные.

```ts
import { toCsv } from "nt-parser";

const csv = toCsv(offices);
```

#### `saveOffices(data, options)`

Сохраняет JSON (с метаданными: sourceUrl, fetchedAt, count) и CSV (с BOM для корректного отображения в Excel) в указанную директорию (по умолчанию `output/`).

```ts
import { saveOffices } from "nt-parser";

const { jsonPath, csvPath } = await saveOffices({ offices, sourceUrl, fetchedAt });
```

### Локальный тест

```bash
npm run dump
```

Скрипт `dump` загружает данные с tvzgo.ru, при наличии переменной окружения `DADATA_API_KEY` выполняет обогащение (при `DADATA_SECRET_KEY` — включается третий шаг через Cleaner API, иначе — четвёртый шаг с очисткой адреса), и сохраняет результат в `output/offices.json` и `output/offices.csv`. При отсутствии ключа выводит подсказку. Переменные задаются в файле `.env` (пример — `.env.example`).

## Типы

Пакет включает типы для всех экспортируемых функций и данных:

```ts
import type {
  Office,
  EnrichedOffice,
  DadataAddressInfo,
  FetchOptions,
  EnrichDadataOptions,
  FetchOfficesResult
} from "nt-parser";
```

## Лицензия

MIT