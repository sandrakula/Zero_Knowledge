# ZeroKnowledge — техническая документация

Подробное описание технической части проекта: стек, слои, модель данных, AI-слой, образовательное
ядро (математика мастерства, доказательства, диагностика, генерация), API, фронтенд, поток
пользователя, безопасность и известные ограничения.

> Документ описывает **фактическое состояние кода**, а не пожелания. Всё, чего в проекте нет,
> вынесено в раздел «Известные ограничения» (§16) — намеренно, без умолчаний.

---

## Содержание

1. [Обзор и принципы](#1-обзор-и-принципы)
2. [Стек и версии](#2-стек-и-версии)
3. [Структура репозитория](#3-структура-репозитория)
4. [Слои и поток запроса](#4-слои-и-поток-запроса)
5. [Конфигурация и окружение](#5-конфигурация-и-окружение)
6. [Запуск, скрипты, база](#6-запуск-скрипты-база)
7. [Модель данных](#7-модель-данных)
8. [Аутентификация, сессии, изоляция, роли](#8-аутентификация-сессии-изоляция-роли)
9. [AI-слой (провайдер-абстракция)](#9-ai-слой-провайдер-абстракция)
10. [Каталог промптов](#10-каталог-промптов)
11. [Образовательное ядро](#11-образовательное-ядро)
12. [Изолированное исполнение кода](#12-изолированное-исполнение-кода)
13. [Справочник API](#13-справочник-api)
14. [Фронтенд](#14-фронтенд)
15. [Поток пользователя end-to-end](#15-поток-пользователя-end-to-end)
16. [Обработка ошибок и отказоустойчивость](#16-обработка-ошибок-и-отказоустойчивость)
17. [Безопасность и приватность](#17-безопасность-и-приватность)
18. [Известные ограничения и что дальше](#18-известные-ограничения-и-что-дальше)
19. [Рецепты расширения](#19-рецепты-расширения)
20. [Связанные документы](#20-связанные-документы)

---

## 1. Обзор и принципы

ZeroKnowledge — адаптивная образовательная система. Ядро — не контент и не чат, а **модель
состояния ученика**, которая обновляется доказательствами и определяет следующий шаг.

Инварианты, которые держат архитектуру:

| Принцип | Как реализован |
|---|---|
| Состояние ученика — источник истины | SQLite, таблицы `CompetencyState` / `Evidence` / `Goal` / `Roadmap` |
| AI — усилитель, а не фундамент | образовательные решения принимает детерминированный код; LLM только генерирует и интерпретирует |
| Свободный текст не меняет состояние | любой ответ модели проходит Zod-схему (`generateObject`) |
| Детерминированная проверка первична | код ученика исполняется в песочнице; AI-разбор идёт поверх и не переопределяет результат |
| Провайдер-независимость | `ProviderAdapter` + роутер по capability; модель задаётся через env |
| Доказательства неизменяемы и объяснимы | `Evidence` + `lineage`; любое значение вектора можно проследить |
| Работает без материалов | цель → диагностика → генерация (cold start); материалы опциональны |
| Материалы не подменяются | `provenance` + `sourceIds` у контента; генерация маркируется |

---

## 2. Стек и версии

### Прод-зависимости

| Пакет | Версия | Роль |
|---|---|---|
| `next` | 15.5.27 | App Router: и SSR-страницы, и API (route handlers) |
| `react` / `react-dom` | 19.0.0 | UI |
| `typescript` | 5.7.2 | строгая типизация (`strict: true`) |
| `@prisma/client` / `prisma` | 6.2.1 | ORM и миграции схемы |
| `zod` | 3.24.1 | схемы ответов LLM и валидация |
| `tailwindcss` | 3.4.17 | стили (CSS-first токены в `globals.css`) |
| `framer-motion` | 11.15.0 | анимации и переходы |
| `lucide-react` | 0.469.0 | иконки |
| `@monaco-editor/react` | 4.6.0 | редактор кода (VS Code) |
| `react-markdown` + `remark-gfm` | 9.0.1 / 4.0.0 | рендер Markdown (уроки, фидбек, тьютор) |
| `pdf-parse` | 1.1.1 | извлечение текста из PDF |
| `mammoth` | 1.8.0 | извлечение текста из DOCX |
| `clsx` + `tailwind-merge` | 2.1.1 / 2.6.0 | склейка классов (`cn()`) |
| `dotenv` | 16.4.7 | загрузка `.env` в seed-скрипте |

### Dev-зависимости

`typescript`, `tailwindcss`, `postcss` 8.4.49, `autoprefixer` 10.4.20, `tsx` 4.19.2,
`@types/node` 22.10.5, `@types/react` 19.0.4, `@types/react-dom` 19.0.2.

### Что осознанно НЕ используется

`NestJS`, `Python/FastAPI`, `PydanticAI`, `LangGraph`, `Temporal`, `Redis`, `S3`, `pgvector`,
`PostgreSQL`, `Docker`. Обоснование — `docs/ADR-001` (модульный монолит сначала). Схема данных
при этом PostgreSQL-совместима: переход = смена `DATABASE_URL` + провайдера в `schema.prisma`.

### Внешние зависимости времени выполнения

- **Python 3** в `PATH` (`python` на Windows, `python3` иначе) — для исполнения кода ученика.
- **AI-шлюз** с OpenAI-совместимым API (`/v1/chat/completions`).

---

## 3. Структура репозитория

```
D:\Learning_prj
├─ prisma/
│  ├─ schema.prisma            # 20 моделей (с β-постериором, иерархией RoadmapItem, Conversation)
│  ├─ seed.ts                  # админ + 45 навыков
│  ├─ migrate-competency.ts    # недеструктивная миграция на β-постериор (§24)
│  └─ dev.db                   # SQLite (gitignored)
├─ scripts/
│  ├─ smoke.mjs                # e2e-проверка живого API
│  └─ upgrade-smoke.mjs        # e2e-проверка апгрейда (hub, тьютор, ветки, подшаги, метрики)
├─ storage/materials/          # загруженные файлы (gitignored)
├─ docs/
│  ├─ ADR-001..005.md
│  └─ TECHNICAL.md             # этот документ
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx            # корневой layout + I18nProvider
│  │  ├─ globals.css           # токены дизайна, утилиты, prose
│  │  ├─ page.tsx              # редирект по сессии
│  │  ├─ login/ register/      # публичные страницы
│  │  ├─ admin/                # админ-панель
│  │  ├─ api/                  # route handler'ы (auth, state, skills, roadmap(+substeps), learn, run, attempt, tutor(+conversations), recommend, diagnostic, materials, admin)
│  │  └─ (app)/                # группа с общим каркасом
│  │     ├─ layout.tsx         # guard + AppShell + FloatingTutor
│  │     ├─ onboarding/ diagnostic/
│  │     ├─ tutor/ home/ roadmap/ learn/[itemId]/
│  │     └─ learning/          # единый Learning hub: секции Overview + Materials
│  ├─ components/
│  │  ├─ i18n.tsx              # провайдер языка
│  │  ├─ shell/app-shell.tsx   # сайдбар, аккаунт, язык, FloatingTutor
│  │  ├─ ui/                   # logo, spinner, progress-ring, markdown, reveal, language-toggle
│  │  ├─ auth/ onboarding/ diagnostic/ home/ roadmap/
│  │  ├─ learn/ tutor/ learning/ materials/ admin/
│  ├─ lib/
│  │  ├─ llm/                  # types, provider, router, structured
│  │  ├─ prompts/registry.ts   # каталог промптов
│  │  ├─ core/                 # образовательное ядро (mastery, competency, evidence, student-twin, roadmap, tutor(+actions), conversation, learn, taskgen, evaluation, content, materials, diagnostic, goal, knowledge-graph, code-runner, json)
│  │  ├─ auth.ts password.ts db.ts api.ts
│  │  ├─ i18n.ts lang.ts types.ts utils.ts
│  └─ types/pdf-parse.d.ts
├─ next.config.mjs
├─ tailwind.config.ts
├─ pnpm-workspace.yaml         # trustLockfile + allowBuilds
└─ .env / .env.local / .env.example
```

---

## 4. Слои и поток запроса

```
┌──────────────────────────────────────────────────────────────┐
│ UI: React-компоненты («use client»)                          │
│  состояние — локальный useState; авторитетное состояние — на  │
│  сервере; в браузере хранится только выбранный язык (zk_lang) │
└───────────────────────────┬──────────────────────────────────┘
                            │ fetch (JSON / FormData)
┌───────────────────────────▼──────────────────────────────────┐
│ API: src/app/api/**/route.ts                                 │
│  requireUser() → learnerId │ проверка прав │ handle()        │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ ОБРАЗОВАТЕЛЬНОЕ ЯДРО: src/lib/core/*                         │
│  детерминированная логика + вызовы LLM через lib/llm         │
└──────┬────────────────────────────────────────────┬──────────┘
       │ Prisma                                     │ generateObject / generateText
┌──────▼──────────────┐                  ┌──────────▼─────────────┐
│ SQLite (dev.db)     │                  │ llm/router → adapter   │
│ 20 таблиц           │                  │  → OpenAI-совместимый  │
└─────────────────────┘                  │    шлюз → модель       │
       ▲                                 └────────────────────────┘
       │ spawn (python)                  ┌────────────────────────┐
┌──────┴──────────────────────────────────▼──────────────────────┐
│ code-runner: временная папка + подпроцесс Python (таймаут 8 c) │
└────────────────────────────────────────────────────────────────┘
```

Характерная цепочка (оценка попытки):

```
POST /api/attempt
  → requireUser()                                   (сессия → learnerId)
  → evaluateAttempt()
      → runTests()                                  (Python-подпроцесс, скрытые тесты)
      → generateObject(ReviewSchema, "coding", …)   (AI-разбор, только при провале)
      → applyEvidence()                             (обновление CompetencyState + Misconception)
      → createEvidence()                            (Evidence + LearningEvent)
      → markItemCompleted()                         (статусы RoadmapItem)
  → JSON: { passed, total, feedback, testResults, competency }
```

---

## 5. Конфигурация и окружение

### Файлы

| Файл | Назначение | В git |
|---|---|---|
| `.env` | несекретное: `DATABASE_URL` | нет |
| `.env.local` | секреты: `LLM_API_KEY`, `SESSION_SECRET` + модели | нет |
| `.env.example` | шаблон без значений | **да** |

### Переменные

| Переменная | Читается в | Значение по умолчанию | Смысл |
|---|---|---|---|
| `DATABASE_URL` | `schema.prisma` | — | `file:./dev.db` (путь относительно `prisma/`) |
| `SESSION_SECRET` | `lib/auth.ts` | `zeroknowledge-dev-secret-change-me` | ключ подписи сессионных токенов |
| `LLM_BASE_URL` | `lib/llm/router.ts` | `https://llm.azati.ai/v1` | база OpenAI-совместимого API |
| `LLM_API_KEY` | `lib/llm/router.ts` | `""` | ключ (Bearer) |
| `LLM_MODEL_FAST` | `lib/llm/router.ts` | `deepseek-v4-flash` (fallback) | модель для capability `fast` |
| `LLM_MODEL_STRONG` | `lib/llm/router.ts` | — | для `strong` и `reasoning` |
| `LLM_MODEL_CODING` | `lib/llm/router.ts` | — | для `coding` |
| `LLM_PROVIDER` | **нигде** | — | информационная: код её не читает (см. §18) |

### `next.config.mjs`

```js
{ reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "pdf-parse", "mammoth"] }
```
Внешние пакеты не бандлятся — важно для `pdf-parse` (CommonJS + pdf.js) и нативных движков Prisma.

### `pnpm-workspace.yaml`

```yaml
trustLockfile: true        # отключает медленную supply-chain проверку lockfile
allowBuilds:               # разрешает build-скрипты (иначе Prisma-движок не встанет)
  '@prisma/client': true
  '@prisma/engines': true
  esbuild: true
  prisma: true
```

---

## 6. Запуск, скрипты, база

| Скрипт | Команда | Что делает |
|---|---|---|
| `pnpm dev` | `next dev -p 3100` | dev-сервер с hot reload |
| `pnpm build` | `next build` | прод-сборка + проверка типов |
| `pnpm start` | `next start -p 3100` | запуск собранного приложения |
| `pnpm typecheck` | `tsc --noEmit` | только типы |
| `pnpm db:generate` | `prisma generate` | генерация клиента |
| `pnpm db:push` | `prisma db push` | применение схемы к БД |
| `pnpm db:seed` | `tsx prisma/seed.ts` | админ + 45 навыков |
| `pnpm db:reset` | `push --force-reset && seed` | полный сброс |
| `pnpm db:migrate-competency` | `tsx prisma/migrate-competency.ts` | недеструктивная миграция на β-постериор (§24) |
| `pnpm test` | `node --import tsx --test "src/**/*.test.ts"` | unit-тесты чистого ядра (mastery/competency/evidence/roadmap) |

Порядок первого запуска: `pnpm install` → `pnpm db:push` → `pnpm db:seed` → `pnpm dev`.

**`prisma/seed.ts`** идемпотентен (`upsert`): создаёт пользователя `admin` (пароль `admin`,
роль `admin`, хеш через `src/lib/password.ts`), `Learner` для него, 45 навыков и связи пререквизитов.

---

## 7. Модель данных

Провайдер — SQLite, 20 моделей. Все «списочные» поля хранятся как **JSON-строки** (у SQLite нет
массивов) — это осознанный компромисс MVP; при переезде на Postgres их стоит превратить в
`jsonb`/связующие таблицы.

### 7.1 Идентичность

**`User`** — учётная запись.

| Поле | Тип | Примечание |
|---|---|---|
| `id` | String @id | cuid |
| `email` | String @unique | логин |
| `name` | String | отображаемое имя |
| `passwordHash` | String | `соль:хеш` (scrypt) |
| `role` | String | `student` \| `admin` |
| `language` | String | `en` \| `ru` |
| `createdAt` | DateTime | |

**`Learner`** — «учебный профиль». Ключевая деталь: **`Learner.id === User.id`**, поэтому
`learnerId` во всех таблицах — это фактически `userId`. Это позволяет не тащить join ради
определения владельца.

| Поле | Тип |
|---|---|
| `id` | String @id (= user.id) |
| `name` | String |
| `userId` | String? @unique → `User` |
| `createdAt` | DateTime |

Связи: `goals`, `competencies`, `misconceptions`, `evidence`, `events`, `attempts`, `hints`,
`messages`, `recommendations`, `materials`.

### 7.2 Цель и граф навыков

**`Goal`** — цель ученика.

| Поле | Тип | Примечание |
|---|---|---|
| `learnerId` | String → Learner | владелец |
| `title` | String | краткое название (от LLM) |
| `statement` | String | исходная формулировка ученика |
| `domain` | String | домен из `knowledge-graph` |
| `targetLevel` | String | beginner/intermediate/advanced |
| `hoursPerWeek` | Int @default(5) | из формы онбординга |
| `deadline` | DateTime? | опционально |
| `status` | String @default("active") | active \| achieved \| archived |
| `roadmap` | Roadmap? | 1:1 |
| `targetSkills` | GoalSkill[] | целевые навыки |

**`GoalSkill`** — связь цели с навыком: `@@unique([goalId, skillId])`, поля `weight` (Float, 1),
`priority` (Int, порядок из компилятора).

**`Skill`** — узел графа знаний. `id` — человекочитаемый ключ (например `python.return_values`),
он же используется во всех JSON-полях.

| Поле | Тип |
|---|---|
| `name`, `description` | String |
| `domain` | String |
| `category` | String (concept \| skill \| subskill) |
| `difficulty` | Float (статичный приор 0..1) |
| `cognitiveLevel` | String |
| `prerequisites` / `prereqOf` | self-relation `"Prerequisite"` (неявная m2m) |

### 7.3 Состояние ученика

**`CompetencyState`** — вектор компетенции, одна строка на пару (ученик, навык),
`@@unique([learnerId, skillId])`. Постериор мастерства хранится явно как (α, β) — он
никогда не восстанавливается из округлённых процентов.

| Поле | Тип | Смысл |
|---|---|---|
| `masteryAlpha` / `masteryBeta` | Float | параметры Beta-постериора (приор α₀=1, β₀=3 → среднее 0.25) |
| `mastery` | Float | зеркало среднего α/(α+β) для дешёвых чтений/совместимости |
| `masteryUncertainty` | Float | LEGACY-прокси (сейчас — std постериора); новые расчёты используют α/β + `evidenceCount` |
| `evidenceCount` | Int | осмысленных наблюдений сверх приора |
| `depth` | String | ступень когнитивной глубины (`recognition`..`transfer`) |
| `independence` | Float | самостоятельность 0..1 (EMA по `supportUsed`) |
| `application` | Float | интеграция нескольких навыков (только явно интегративные задачи) |
| `transfer` | Float | применение в новых контекстах (только явно трансферные задачи) |
| `retention` | Float | последняя измеренная извлекаемость (со временем затухает) |
| `attempts` / `successes` | Int | счётчики |
| `independentSuccesses` | Int | успехи с `supportUsed < 0.5` |
| `integrationAttempts` / `transferAttempts` | Int | счётчики соответствующих задач |
| `retentionChecks` / `retentionSuccesses` | Int | счётчики отложенных проверок удержания |
| `supportDependence` | Float | скользящее среднее использованной помощи (0..1) |
| `hintDependence` | Float | LEGACY — заменено на `supportDependence` |
| `taskFamilies` | JSON | различные семейства задач (покрытие доказательств) |
| `depthCounts` | JSON | независимые успехи по каждой ступени глубины |
| `lastSeenAt` / `lastAssessmentAt` / `lastRetrievedAt` | DateTime | контакт / последняя оценка / последнее припоминание |
| `updatedAt` | DateTime @updatedAt | |

**`Misconception`** — состояние заблуждения, `@@unique([learnerId, skillId, code])`:
`code`, `description`, `confidence` (Float, 0.5), `status` (`active`\|`monitoring`\|`resolved`),
`evidenceIds` (JSON), `resolvedAt`.

**`Evidence`** — зафиксированное наблюдение (главная таблица доверия).

| Поле | Смысл |
|---|---|
| `skillIds` | JSON-массив затронутых навыков |
| `kind` | `diagnostic` \| `attempt` \| `transfer` \| `retention` \| `explanation` \| `tutor` \| `project` |
| `method` | `deterministic` \| `rubric` \| `ai-interpretation` \| `trace` |
| `strength` | Float 0..1 — вес наблюдения |
| `value` | JSON: полный `EvidencePayload` |
| `summary` | человекочитаемая строка |
| `lineage` | JSON: taskId, hintsUsed, confidence, passedAll и т.п. |
| `taskId` / `attemptId` | ссылки на источник |

**`LearningEvent`** — поток событий: `type` (например `evidence_attempt`, `confidence_submitted`,
`goal_created`, `diagnostic_completed`, `content_generated`, `material_uploaded`,
`roadmap_item_completed`), `skillId?`, `payload` (JSON).

**`TaskAttempt`** — попытка: `code`, `passed`, `total`, `passedAll`, `hintsUsed`, `supportUsed`,
`confidence`, `timeSpentSeconds`, `verification` (JSON: метод и счёт), `feedback` (Markdown),
`evidenceId`, `roadmapItemId`.

**`Recommendation`**, **`HintUsage`**, **`Message`** — соответственно рекомендация
(`action` JSON, `reason`, `priority`, `status`), факт использования подсказки (`taskId`, `level`)
и сообщение переписки (`role`, `content`, `intent`, `meta`).

**`Conversation`** — персистентный диалог тьютора (§54): `learnerId`, `title`, `summary`,
`activeGoalId`, `activeRoadmapItemId`, `messageCount`, `lastMessageAt`, `archivedAt`.
`Message` связан с ним через `conversationId` и дополнительно несёт `skillIds` (JSON),
`taskId`, `roadmapItemId`, `meta` (JSON: результаты действий тьютора). Разговор хранит
сказанное; модель ученика хранит, что ученик умеет делать — это разные сущности.

### 7.4 План обучения

**`Roadmap`** — 1:1 к цели (`goalId @unique`): `summary` (текст от LLM), `status`.

**`RoadmapItem`** (иерархический узел, §31–35):

| Поле | Смысл |
|---|---|
| `index` | порядок среди соседей |
| `phase` | название фазы |
| `title`, `description`, `objective` | заголовок, описание, короткая цель шага |
| `skillIds` | JSON-массив навыков пункта |
| `type` | `concept` \| `lesson` \| `example` \| `practice` \| `task` \| `project` \| `assessment` \| `retention` \| `transfer` |
| `status` | `locked` \| `ready` \| `active` \| `completed` |
| `contentId` / `taskId` | ссылки на урок/задачу |
| `parentId` / `children` | самосвязь `RoadmapItemTree` (подшаги) |
| `optional` | необязательный пункт (не блокирует основной путь) |
| `origin` | `main` \| `tutor` (кто создал узел) |
| `branchKey` | ключ параллельной ветки практики от тьютора |
| `completedAt` / `updatedAt` | время завершения/обновления |
| `estimatedMinutes` | Int |

### 7.5 Контент и материалы

**`ContentItem`** (урок/объяснение): `title`, `body` (Markdown), `kind`, **`provenance`**
(`canonical` \| `user-provided` \| `teacher-provided` \| `external` \| `generated` \| `enriched`),
`status`, **`sourceIds`** (JSON — id материалов, на которых основан), `language`, `version`, `meta`.

**`Task`**: `skillIds`, `family`, `title`, `statement`, `difficulty`, `cognitiveLevel`,
`independenceRequired`, `transferLevel`, `integrationLevel` (явная классификация
интеграции §17), `starterCode`, `referenceSolution`, `tests` (JSON
`[{input, expected}]`), `hints` (JSON), `status` (`validated`), `provenance`, `sourceIds`, `language`.

**`Material`** / **`MaterialChunk`**: файл и его фрагменты. У `Material` есть
**`scope`** (`user` \| `global`) — общие материалы админа; `language` (автоопределение),
`skillIds` (JSON — покрытые навыки), `summary`, `chunkCount`. У чанка — `index`, `heading`, `text`.

### 7.6 Служебное

**`DiagnosticQuestion`** — сохранённый ключ ответа: `id` (используется как questionId),
`learnerId`, `skillId`, `correctIndex`, `explanation`, `misconception`. Существует именно для
того, чтобы диагностика переживала перезапуск сервера.

**`Conversation`** — см. §7.3 (персистентный диалог тьютора).

---

## 8. Аутентификация, сессии, изоляция, роли

Модули: `src/lib/password.ts`, `src/lib/auth.ts`, `src/lib/api.ts`.

### 8.1 Пароль

```ts
hashPassword(p)     → `${salt}:${scryptSync(p, salt, 64).toString("hex")}`   // salt = 16 байт hex
verifyPassword(p, s) → timingSafeEqual(scryptSync(p, salt, 64), hexToBuffer(hash))
```
`scrypt` из `node:crypto`, внешних зависимостей нет. Хеширование вынесено в отдельный модуль без
импортов Next.js, чтобы его мог использовать `prisma/seed.ts`.

### 8.2 Сессия

- Токен: `base64url(JSON.stringify({userId, exp})) + "." + HMAC-SHA256(body, SESSION_SECRET)`.
- Cookie `zk_session`: `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `maxAge: 30 дней`.
- Проверка: длина подписи → `timingSafeEqual` → разбор payload → проверка `exp`.
- Серверного хранилища сессий нет (stateless) — перезапуск сервера не разлогинивает.

### 8.3 Изоляция

```ts
requireUser(): Promise<string>   // cookies().zk_session → verify → userId, иначе ApiError(401)
```
`learnerId === userId`. Все запросы данных содержат `where: { learnerId: userId }` — идентификатор
никогда не приходит от клиента. Права админа проверяются отдельно (`role === "admin"`, иначе 403).

### 8.4 Роли

| Роль | Возможности |
|---|---|
| `student` | всё в рамках своего `learnerId` |
| `admin` | `/admin`, `/api/admin/overview` (сводка по всем), загрузка материалов со `scope: "global"` |

При входе: `admin → /admin`, иначе `→ /tutor`.

---

## 9. AI-слой (провайдер-абстракция)

`src/lib/llm/` — четыре файла, бизнес-логика о вендоре не знает ничего.

### 9.1 `types.ts` — контракт

```ts
type Capability = "fast" | "strong" | "coding" | "reasoning";
type Message = { role: "system" | "user" | "assistant"; content: string };
type ChatOptions = { temperature?; maxTokens?; json?; signal? };
type LLMResponse = { content: string; reasoning?: string; model: string; usage?: Usage };

interface ProviderAdapter { readonly id: string; complete(messages, opts?): Promise<LLMResponse> }
class ProviderError extends Error { status?: number; retryable: boolean }
```

### 9.2 `provider.ts` — OpenAI-совместимый адаптер

- `POST {baseUrl}/chat/completions`, заголовок `Authorization: Bearer <key>`.
- Тело: `{ model, messages, temperature, max_tokens, response_format? }`.
- Таймаут запроса — 120 c через `AbortController`.
- Извлекает `choices[0].message.content` и `reasoning_content`; usage — включая `reasoning_tokens`.
- **Пустой `content` считается retryable-ошибкой** (см. §16 — это следствие reasoning-модели).

### 9.3 `router.ts` — выбор модели и ретраи

```
capability        → env
fast              → LLM_MODEL_FAST
strong            → LLM_MODEL_STRONG
coding            → LLM_MODEL_CODING
reasoning         → LLM_MODEL_STRONG
fallback: LLM_MODEL_FAST → LLM_MODEL_STRONG → "deepseek-v4-flash"
```
`route()` кеширует адаптер на capability. `complete()` делает до **3 повторов** на retryable-ошибки
с backoff `800ms × (i+1)`. Кеш сбрасывается `resetRouter()`.

### 9.4 `structured.ts` — типизированный вывод

```ts
generateObject<T>(schema: ZodType<T>, capability, system, user, opts?) → Promise<T>
generateText(capability, system, user, opts?) → Promise<string>
```

`generateObject` — ключевой механизм доверия: **свободный текст не может изменить состояние**.
Внутри:

1. До **3 попыток** всей операции (пустой вывод, ошибка парсинга, несоответствие схеме).
2. `extractJsonObject()` — устойчивое извлечение JSON:
   - снимает внешний ```` ```json … ``` ```` **только если им обёрнуто всё тело**;
   - иначе ищет первый `{` и идёт до **сбалансированной** закрывающей скобки, отслеживая строки и
     экранирование — поэтому фигурные скобки и код-блоки внутри строковых значений не ломают парсинг
     (именно это ломало генерацию задач до фикса);
3. `JSON.parse` → `schema.parse`.
4. При исчерпании попыток — `ProviderError` с фрагментом ответа в тексте ошибки.

Ошибки с `structured`/`AI`/`provider`/`timed out` в `handle()` отдаются как **HTTP 502** (это
внешний сбой, а не баг приложения).

---

## 10. Каталог промптов

Файл `src/lib/prompts/registry.ts`. Промпт — это софт-артефакт: `id`, `version`, `purpose`,
`capability`, `system`. Всего 10 промптов.

| id | ver | capability | Назначение | Формат ответа |
|---|---|---|---|---|
| `goal-compiler` | 1 | strong | цель → домен, уровень, целевые навыки | `{title, domain, targetLevel, targetSkills[], summary}` |
| `diagnostic-question` | 1 | fast | один адаптивный вопрос по навыку | `{question, code, options[4], correctIndex, explanation, misconception}` |
| `diagnostic-evaluate` | 1 | strong | оценка свободного ответа по рубрике | `{correct, confidence, explanation, misconceptions[]}` |
| `roadmap` | 1 | strong | персональный план фазами | `{summary, phases[{phase, items[{title, description, skillIds[], type, estimatedMinutes}]}]}` |
| `lesson` | **2** | strong | урок, привязанный к материалам | `{body, sourceIds[]}` |
| `task` | 1 | coding | задача + эталон + тесты | `{title, family, statement, starterCode, referenceSolution, tests[], hints[], cognitiveLevel, misconceptionTargets[]}` |
| `task-evaluate` | 1 | coding | разбор кода (обучающий, не «готовое решение») | `{correct, feedback, misconceptions[], hintLevel}` |
| `tutor` | 1 | strong | сократический тьютор | `{intent, actionType, reply, misconceptionCode}` |
| `material-analysis` | 1 | strong | материал → навыки + саммари | `{summary, topics[], skillIds[]}` |
| `concept-explanation` | 1 | strong | объяснение одного понятия | текст (Markdown) |

Принципы, зашитые в формулировки: отвечать только id из переданного каталога; не выдумывать
покрытие материала; не выдавать готовое решение; уменьшать подсказку по «лестнице»; отвечать на
запрошенном языке (в user-сообщение добавляется `langInstruction(lang)`).

**Как промпт попадает в модель:**

```ts
const prompt = getPrompt("task")!;
const obj = await generateObject(TaskSchema, prompt.capability, prompt.system, userContext, { maxTokens: 12000 });
```

`version` бампается при изменении поведения (пример: `lesson` v1 → v2 при добавлении grounding).

---

## 11. Образовательное ядро

Модули `src/lib/core/`. Ниже — фактическая логика.

### 11.1 Knowledge Graph (`knowledge-graph.ts`)

Статичный граф-приор, не таблица: **6 доменов** (programming, algorithms, data-structures,
mathematics, statistics, machine-learning) и **45 навыков** с полями
`{id, name, description, domain, category, difficulty, cognitiveLevel, prerequisites[]}`.

Пример цепочки: `math.algebra → math.functions → math.calculus → math.optimization →
ml.gradient_descent → ml.neural_networks`.

Функции: `getSkill`, `getSkillsByDomain`, `ancestors` (транзитивные пререквизиты),
`topologicalOrder`, `misconception(code)`.

**Каталог заблуждений** — 12 записей `MISCONCEPTION_CATALOG` с полями
`{code, name, description, affectedSkills[], trigger, correction, counterExample?}`. Примеры:
`missing-return`, `off-by-one`, `wrong-base-case`, `mutable-default`, `incorrect-complexity`,
`data-leakage`, `precision-recall-confusion`, `correlation-causation`, `chain-rule`, `independence`.

Граф — «экспертный приор»: он задаёт форму (что от чего зависит), а состояние ученика живёт
отдельно и его уточняет.

### 11.2 Evidence Engine (`evidence.ts`)

```ts
methodStrength(method): deterministic 1.0 · rubric 0.75 · ai-interpretation 0.45 · trace 0.35 · default 0.4

createEvidence({learnerId, skillIds, kind, method, value, summary, taskId?, attemptId?, lineage?})
  → prisma.evidence.create(...)  +  prisma.learningEvent.create({ type: `evidence_${kind}` })
  → возвращает evidenceId
```

`EvidencePayload` (хранится в `Evidence.value`):

```ts
{
  correct: boolean,
  strength: number,            // 0..1 — вес наблюдения
  supportUsed: number,         // 0..1 — доля использованной помощи
  hintsUsed: number,
  cognitiveLevel: string,      // ступень, которую проверяла задача
  transferLevel: number,       // 0..1
  independenceRequired: number,
  integrated: boolean,         // задача объединяет несколько навыков
  retentionCheck: boolean,     // это проверка припоминания
  kind: string, method: string,
  misconceptions?: string[]    // коды, которые это наблюдение поддерживает/опровергает
}
```

### 11.3 Мастерство (`mastery.ts`)

Модель — **Beta-Binomial постериор**, хранится явно как (α, β). Приор
`α₀=1, β₀=3` → среднее 0.25, но это слабый приор, а **не** доказательство: до появления
реальных наблюдений UI обязан показывать «Not assessed», а не «25%».

```ts
updatePosterior(p, q, w) → { alpha: α + w·q, beta: β + w·(1 − q) }
posteriorMean(p)         → α / (α + β)
posteriorStd(p)          → sqrt(α·β / ((α+β)² · (α+β+1)))
evidenceCount(p)         → max(0, α + β − 4)
credibleInterval(p, z)   → нормальная аппроксимация, клипается к [0,1] (документированное приближение)
sufficiency(p)           → none(<0.5) | insufficient(<3) | moderate(<8) | strong(≥8)
```

`q ∈ [0,1]` — наблюдаемая доля успеха (0/1 для бинарных вопросов, доля пройденных тестов для
программных задач), `w ∈ [0,1]` — эффективный вес доказательства. Один верный ответ при
`w=1` даёт `mastery = 2/5 = 0.40`, не 100 % — защита от фальшивой точности.

**Лестница глубины** (`DEPTH_LADDER`): `recognition → understanding → application → analysis →
evaluation → creation → transfer`. `depthFromCognitiveLevel()` мапит уровень задачи на ступень;
задача уровня `apply` не доказывает `analysis`.

**Retention** — оценка извлекаемости с экспоненциальным затуханием (half-life 14 дней):
`retentionEstimate(stored, lastRetrievedAt, now) = stored · 0.5^(days/14)`. Задача, решённая в той
же сессии, не считается проверкой удержания.

### 11.4 Student Learning Twin (`student-twin.ts`) и чистые правила (`competency.ts`)

Все правила компетенции собраны в чистом модуле `competency.ts` (без Prisma/React/AI) и
покрыты тестами. `student-twin.ts` только загружает состояние, делегирует правило и пишет
результат обратно.

`applyEvidenceToSkill(state, ev)` обновляет измерения по явным триггерам (§17–21):

| Измерение | Правило |
|---|---|
| `mastery` (α/β) | `updatePosterior(q, effectiveWeight)` — единственное, что меняет любое наблюдение |
| `independence` | EMA: цель `correct ? 1 − supportUsed : ind − 0.15`; шаг η=0.25. Ошибка не растёт самостоятельность |
| `application` | только при `integrationLevel ≥ 0.5`: `+= correct ? 0.18 : −0.12` |
| `transfer` | только при `transferLevel ≥ 0.4`: `+= correct ? 0.2 : −0.08` |
| `retention` | только отложенная проверка (`retentionCheck && retentionDelayed`): `(succ+1)/(checks+2)` |
| `depth` | растёт только при `correct && supportUsed < 0.5` и ≥ 2 независимых успеха на уровне |
| `supportDependence` | EMA(η=0.2) доли использованной помощи |
| счётчики | `evidenceCount`, `attempts`, `independentSuccesses`, `taskFamilies`, `depthCounts` |

Пороги конфигурации — константы `RULES` и `CLASSIFICATION` в `competency.ts`; обычная практика
имеет `transferLevel=0.1` (ниже порога 0.4), одиночный навык — `integrationLevel=0.15` (ниже
порога 0.5), поэтому обычные задачи **не** двигают transfer/application (регрессионные тесты
есть в `competency.test.ts` / `roadmap.test.ts`).

**Классификация статуса** `classifySkill(state, misconceptions)` — единая детерминированная
политика (§28):

- нет осмысленных доказательств (`evidenceCount < 1`) → `not_assessed`;
- активное заблуждение с `confidence ≥ 0.6` или среднее < 0.3 → `needs_attention`;
- иначе → `developing`, кроме строгого `demonstrated`: ≥ 4 наблюдений, среднее ≥ 0.7,
  нижняя граница credible interval ≥ 0.45, ≥ 2 независимых успеха, ≥ 2 семейств задач и
  отсутствие противоречащего активного заблуждения (confidence ≥ 0.5).

Цвета узлов плана вычисляются из `STATUS_COLOR` в `competency.ts` — компоненты никогда
не выводят цвета сами (§27). `rollupStatus()` сворачивает статусы навыков на узел плана.

**Скоуп доказательств (подтема vs навык).** `CompetencyState` (и `Misconception`) хранятся
на пару `(learnerId, skillId, topicId)`. `topicId = ""` — это **агрегат** (среднее по всем
подтемам), который показывает раздел «Обучение»; `topicId = <id пункта плана>` — состояние
конкретной подтемы. `applyEvidence({…, topicId})` пишет доказательство сразу в оба скоупа,
поэтому ошибки одной подтемы не перекрашивают другую, а агрегат остаётся средним.
Узел плана берёт свой `topicId` и падает на агрегат, только пока своих наблюдений нет.

`student-twin.ts` предоставляет read-модель `getCompetencyView()` / `getAllSkillMetrics()` /
`getLearnerSummary()` (единственные формы, которые UI может потреблять) и `recommendNext()`.
Все они читают **агрегатный** скоуп.

**Жизненный цикл заблуждения** (`applyMisconceptionSignal`):

- верный ответ при `supportUsed < 0.5`: `monitoring` → `resolved` (confidence 0.15), иначе
  `confidence −= 0.35`; нет записи — ничего не делаем;
- ошибка/ответ с поддержкой: создать (`confidence 0.5`, `active`) или `confidence += 0.25`;
  `resolved` → `monitoring`.

Одно правильное решение не закрывает заблуждение — нужно устойчивое независимое подтверждение.

### 11.5 Диагностика (`diagnostic.ts`)

**Старт** `startDiagnostic(goalId, learnerId, language?)`:

1. Проверка, что цель принадлежит ученику.
2. Удаление «зависших» вопросов: `diagnosticQuestion.deleteMany({ where: { learnerId } })`.
3. `pickSkills(targetSkills)` — сортировка по `difficulty`; если навыков ≤ 4, берутся все, иначе
   индексы `[0, n/3, 2n/3, n−1]` (фундамент → середина → продвинутый).
4. `generateQuestion(learnerId, skillId, "beginner", language)` → LLM (`diagnostic-question`) →
   запись ключа в `DiagnosticQuestion` → клиенту отдаётся **только** `publicQuestion()`:
   `{id, skillId, skillName, difficulty, question, code, options}`. **`correctIndex` и `explanation`
   клиенту не передаются.**

**Ответ** `answerDiagnostic({goalId, ladder, index, questionId, skillId, selectedIndex, confidence, learnerId, language})`:

1. `diagnosticQuestion.findUnique(id)`; если нет или `learnerId` не совпал → ошибка
   «Question expired». Строка сразу удаляется (одноразовый ключ).
2. `correct = selectedIndex === key.correctIndex`.
3. `applyEvidence` со значением: `strength 0.85`, `supportUsed 0`, `method deterministic`,
   `kind diagnostic`, `misconceptions = correct ? [] : [key.misconception]`.
4. `createEvidence` + `LearningEvent` типа `confidence_submitted`
   (payload: `{confidence, correct, calibration}`) — материал для обучения калибровке уверенности.
5. Переход: `nextIndex = index + 1`; если `nextIndex >= ladder.length` — диагностика завершена.
6. **Финал**: только событие `diagnostic_completed`; в ответе `{done: true, next: null}`.
   Роадмап **не строится** внутри ответа — он создаётся отдельно (`POST /api/roadmap/ensure`)
   на экране завершения, чтобы последний вердикт не ждал генерацию.
7. Иначе в ответе сразу возвращается `next: {index, skillId, level}`, где
   `level = correct ? levelFor(0.6) : "beginner"` (`levelFor`: `<0.33` beginner, `<0.66` intermediate,
   иначе advanced). Сам вопрос генерирует отдельный запрос `nextDiagnosticQuestion`
   (`POST /api/diagnostic/next`) — вердикт никогда не ждёт модель.

Ответ `answerDiagnostic` содержит `correct` и `feedback` немедленно (без LLM-вызова), `next` —
метаданные следующего вопроса, либо `null` если диагностика завершена.

### 11.6 Компилятор цели (`goal-compiler.ts`, `goal.ts`)

`compileGoal({statement, level, language})`: в промпт передаётся каталог навыков
(`skillCatalogForPrompt()` — JSON из id, name, domain, difficulty, prerequisites), ответ
валидируется схемой, затем:

- id, которых нет в каталоге, отбрасываются;
- к целевым навыкам **добавляется транзитивное замыкание по пререквизитам** (`ancestors`), чтобы
  план не начинался с недостижимого шага.

`createGoalFromStatement(...)` (используется и онбордингом, и тьютором):
`ensureLearner` → `compileGoal` → `Goal` → `GoalSkill` (по строке на навык, `priority = индекс`) →
событие `goal_created`. **Роадмап здесь не создаётся** — это принципиально (см. §15.3).

### 11.7 Curriculum / Roadmap (`roadmap.ts`)

`generateRoadmap({goalId, learnerId, spec, competency, masteredSkills?, language})`:

- на вход промпту `roadmap`: название цели, целевой уровень, упорядоченные целевые навыки,
  текущее мастерство по ним, карта пререквизитов, язык. Промпт требует **подшаги внутри каждого
  пункта** (`substeps`), поэтому план приходит уже разбитым;
- `masteredSkills` — навыки, которые ученик решает **уверенно** (`isConfidentlyMastered`):
  жёсткое правило сжатия (не создавать новые уроки/практику, максимум один короткий `retention`);
- предыдущий роадмап удаляется **в правильном порядке** (сначала `RoadmapItem`, потом `Roadmap`,
  иначе FK-ограничение);
- `Roadmap` + корневые `RoadmapItem` (все со статусом `ready`, `index` сквозной);
- для каждого пункта, кроме одиночных проверок (`retention`, `diagnostic`), его `substeps`
  записываются дочерними `RoadmapItem` (`origin: "main"`, `index = rootIndex * 1000 + n`) —
  за один вызов модели, без второго прохода.

`ensureRoadmap({goalId, learnerId, language?, force?})` — идемпотентно строит план, если его нет
(`force` — перестроить существующий, используется после повторной диагностики).

`buildRoadmapFromGoal({goalId, learnerId, language})` — восстановление `GoalSpec` из БД
(`Goal` + `GoalSkill`) + чтение текущих `CompetencyState`; вызывается из диагностики.

`getRoadmapView(goalId)` — представление с `skillIds`, распарсенными из JSON.

`markItemCompleted(learnerId, itemId)` — пункт → `completed`, затем первый `locked` → `ready`;
пишет событие `roadmap_item_completed`.

`regenerateRoadmap({learnerId, goalId, language?})` — пересборка по нажатию «Пересобрать план»:
считает `masteredSkillIds` (агрегатный скоуп + `isConfidentlyMastered`), передаёт их генератору,
а затем **сжимает** план — у каждого корня, чьи навыки теперь уверенно освоены или
`demonstrated`, удаляются дочерние подшаги и он помечается `completed` (одна нода вместо серии).
Возвращает `{regenerated, beforeTotal, afterTotal, autoCompleted}` — то есть пересборка после
реального прогресса даёт **меньше**, а не больше подтем.

### 11.8 Генерация задач (`taskgen.ts`)

`generateTask({skillIds, difficulty, cognitiveLevel, transferLevel, independenceRequired, misconceptions?, language})`:

1. `generateObject(TaskSchema, "coding", …)` — `TaskSchema` требует минимум 3 теста и 2 подсказки.
2. `validateTask()` — **эталонное решение исполняется против собственных тестов** в песочнице.
3. Если не прошло — **один повтор** промпта с текстом ошибок валидации; если и он не валиден —
   задача не публикуется, бросается исключение (требование ТЗ §126).
4. `persistTask(task, roadmapItemId?)` — запись `Task` со `status: "validated"`, `provenance: "generated"`,
   `sourceIds: "[]"`, `language`; `roadmapItemId` привязывает задачу к подтеме (банк задач).

Тесты исполняются через stdin/stdout: `input` подаётся на вход, `expected` сравнивается с
`stdout.trim()`.

**Банк задач подтемы.** У каждой подтемы — не одна, а минимум `MIN_TASKS_PER_TOPIC = 3`
проверенных задачи. `openLearnItem` вызывает `ensureTaskBank`: недостающие генерируются
последовательно (`generateIntoBank`), причём следующая задача получает `avoid` — заголовки уже
существующих и `variant {index,total}`, поэтому варианты не повторяются. Сбой генерации не
блокирует обучение. `openLearnItem({taskId})` переключает задачу внутри банка без генерации,
`{newTask:true}` добавляет ещё одну.

**Пакетная генерация (`task-bank-job.ts`).** Кнопка «Сгенерировать все задачи» на
странице плана вызывает `POST /api/tasks/generate-all`: сервер запускает фоновую задачу,
которая обходит все подтемы активной цели с неполным банком (`itemsMissingTasks`) и доводит
каждую до `MIN_TASKS_PER_TOPIC` (`ensureTasksForItem`). Пул из 2 воркеров, прогресс — в
памяти процесса, `GET` отдаёт статус (`running/total/done/failed/current`), `DELETE` —
останавливает после текущей подтемы. Состояние не переживает рестарт сервера — это просто
значит «запусти снова».

### 11.9 Оценка попытки (`evaluation.ts`)

`evaluateAttempt({learnerId, taskId, roadmapItemId, code, hintsUsed, confidence, timeSpentSeconds, language})`:

1. Загрузка `Task`, парсинг `tests` и `skillIds`.
2. **Детерминированная проверка:** `runTests(code, tests)` → `run.passed / run.total`, `passedAll`.
3. Обратная связь:
   - всё прошло → структурированный успешный фидбек (Markdown) с упоминанием навыков;
   - есть провалы → `generateObject(ReviewSchema, "coding", …)` **поверх вывода упавших тестов**;
     при недоступности AI — текстовый фолбэк с ожидаемым/фактическим выводом.
4. Значение доказательства: `supportUsed = clamp(hintsUsed / 3, 0, 1)`,
   `strength = passedAll ? 1.0 : 0.85`, `method = "deterministic"`,
   `integrated = skillIds.length > 1`, `transferLevel`/`cognitiveLevel` — из задачи.
5. `applyEvidence` → `createEvidence` → `TaskAttempt` (с `verification` JSON, `feedback`,
   `evidenceId`).
6. При наличии `confidence` — событие `confidence_submitted`.
7. **Завершение пункта:** если `passedAll && roadmapItemId && supportUsed <= 0.34` — `markItemCompleted`.
   То есть решение «на трёх подсказках» пункт не закрывает.
8. Возврат: `{passed, total, passedAll, feedback, misconceptions, method, testResults[], competency}`.

### 11.10 Контент и grounding (`content.ts`)

`generateLesson({learnerId, skillIds, title, cognitiveLevel, language})`:

1. Калибровка под ученика: текущие `mastery/depth/independence` по навыкам + активные заблуждения.
2. **Retrieval:** `retrieveChunks({learnerId, skillIds, limit: 4})` — фрагменты материалов
   (свои + общие), отобранные по пересечению ключевых слов.
3. Промпт `lesson` v2 получает блок `SOURCE MATERIAL EXCERPTS` с `id`, `material`, `heading`.
4. Ответ `{body, sourceIds}`; `sources` — использованные материалы.
5. `ensureLessonForItem` сохраняет `ContentItem`: `provenance = grounded ? "enriched" : "generated"`,
   `sourceIds`, `language`, `meta`; пишет `contentId` в пункт плана и событие `content_generated`.

Повторное открытие пункта **переиспользует** сохранённый урок (и задачу).

### 11.11 Материалы (`materials.ts`)

| Шаг | Реализация |
|---|---|
| Извлечение текста | `.txt/.md/.text/.csv/.json` → utf8; `.pdf` → `pdf-parse`; `.docx` → `mammoth` |
| Определение языка | доля кириллицы среди букв > 0.35 → `ru`, иначе `en` |
| Нарезка | по пустым строкам, группировка до `maxChars = 1400`; строка < 90 символов, ≤ 12 слов и без завершающей точки считается заголовком |
| Анализ | `generateObject(material-analysis)`, первые ~18 000 символов → `{summary, topics, skillIds}` |
| Хранение | `Material` (+`scope`), `MaterialChunk`, файл в `storage/materials/<userId>/<stamp><ext>` |

**Retrieval** (`retrieveChunks`): `tokenize` (нижний регистр, удаление не-букв/цифр, токены длиной > 2),
запрос строится из `name + description` целевых навыков; `score = |пересечение| / |запрос|`;
порог `> 0.08`; топ-4. Выборка чанков — **свои И глобальные**:

```ts
where: { OR: [{ learnerId }, { material: { scope: "global" } }] }
```

Это не эмбеддинги, а лексическое совпадение — осознанный компромисс MVP (см. §18).

### 11.12 Тьютор (`tutor.ts`), диалоги и действия

`tutor({learnerId, message, conversationId?, roadmapItemId?, taskId?, code?, language?})`:

1. Резолвится (или создаётся) активный `Conversation`; сообщение пользователя сохраняется
   через `appendMessage()` (ownership проверяется по сессии, не по клиентскому id).
2. **Ветка «нет цели»:** если активной цели нет — короткое сообщение (< 12 симв.) даёт
   `clarify_goal`; иначе `createGoalFromStatement` → `goal_created` + `goalId`.
3. **Обычная ветка:** `buildTutorContext()` собирает ограниченный контекст (§58, §61): цель,
   roadmap-узлы со стабильными id, **текущий узел вместе с его родителем и соседними подтемами
   (текущая отмечена ▸)**, текущий банк-задачу (`taskId`), **текущий неотправленный код из
   редактора** (`code`) или последний сохранённый, результат проверки, компетенции по навыкам,
   активные заблуждения, последние попытки, материалы и ограниченный срез истории +
   релевантная ретро-выборка (`searchConversationHistory`, лексическая).
   Ответ — `TutorSchema` `{intent, actionType, reply, misconceptionCode, action?}`.

**Живой контекст.** `LearnClient` публикует событие `zk:learn-context`
(`{itemId, taskId, code}`), `useTutor()` его слушает и отправляет вместе с сообщением;
на `/learn/[id]` itemId также берётся из URL. Так тьютор всегда отвечает про то, что
открыто на экране сейчас, а не про догадку из `status: active`.
4. **Структурное действие** (если модель предложила): выполняется только через
   `executeTutorAction()` (`tutor-actions.ts`) — модель никогда не пишет в Prisma напрямую.
   Результат валидируется, сохраняется и возвращается с фактическим итогом (`describeActionResult`).
5. Ответ ассистента сохраняется с `intent`/`actionType`/`meta`.
6. **Разговор как микро-оценка:** только явный `misconceptionCode` создаёт слабое доказательство
   `kind: "tutor"`, `method: "ai-interpretation"` (вес ~0.45) — мнение ИИ не равно детерминированному
   результату.

**Действия тьютора** (§37, §40, §69–71) — `tutor-actions.ts`: `GENERATE_TASKS` /
`CREATE_ROADMAP_BRANCH` (валидированная генерация задач + параллельная ветка), `ADD_ROADMAP_SUBSTEPS` /
`EDIT_ROADMAP_NODE` (структурные правки плана через core-сервисы, с аудит-событиями). Все id
проверяются на владение.

**Диалоги** — `conversation.ts` (§53–60): `getOrCreateActiveConversation`, `createConversation`
(архивирует предыдущий), `listConversations`, `getConversationMessages` (ownership-checked),
`appendMessage`, `recentConversationContext` (bounded), `searchConversationHistory` (ключевое слово).
История диалога — это сказанное; Student Learning Twin — это умения; заявление «я всё понял» не
меняет компетенцию (§63).

**Floating tutor** (§48–51): смонтирован в `AppShell`, доступен на всех авторизованных страницах;
тот же `useTutor()`/backend, что и полная страница `/tutor` — история одна (§52).

### 11.13 Мастерство и рекомендации (`recommendNext`)

Кандидаты и скоринг:

| Источник | Условие | Скор |
|---|---|---|
| Пункты плана | не `completed`, все пререквизиты навыков пункта имеют `mastery ≥ 0.5` | `0.7·(1 − min mastery по навыкам пункта) + 0.3·(1 − min retention) + (навыков > 1 ? 0.05 : 0)` |
| Повторение | `mastery ≥ 0.55 && retention < 0.5` | `(1 − retention) · 0.9` |
| Интервенция | активные заблуждения (топ-3 по confidence) | `0.75 + confidence · 0.2` |

Список сортируется по убыванию; первый элемент — `next`, первые шесть — `queue`. Это и есть ответ
на «что делать дальше» — с обоснованием (`reason`), а не магический балл.

### 11.14 Админ-сводка (`admin.ts`)

`getAdminOverview()` по каждому ученику (`role: "student"`) собирает: цель, наличие диагностики,
прогресс плана (`completed / total`), среднее мастерство, число освоенных навыков (`mastery ≥ 0.6`),
всего попыток, попыток за 7 дней, доказательств, активных заблуждений, материалов, время последнего
события. Плюс агрегаты: число учеников, глобальных материалов, всего попыток и доказательств.

---

## 12. Изолированное исполнение кода

`src/lib/core/code-runner.ts`.

```ts
runPython(code, stdin) → { ok, stdout, stderr, exitCode, timedOut, durationMs }
runTests(code, tests)  → { passed, total, results[{...result, expected, pass}] }
```

Как именно изолировано:

- код пишется в **одноразовую временную папку** (`mkdtemp` в `os.tmpdir()`), `cwd` процесса — эта папка;
- запускается **отдельный процесс** `python`/`python3`, никогда не приложение;
- `stdio: ["pipe","pipe","pipe"]`, `windowsHide: true`, `PYTHONUNBUFFERED=1`;
- **таймаут 8 секунд** → `SIGKILL`;
- папка удаляется в `finally`;
- результат: `ok = (exitCode === 0 && !timedOut)`;
- сравнение с ожидаемым — точное (`stdout.trim() === expected.trim()`).

`/api/run` даёт ученику «просто запустить» с произвольным stdin; `/api/attempt` прогоняет скрытые
тесты и создаёт доказательства.

---

## 13. Справочник API

Все обработчики: `export const dynamic = "force-dynamic"`. Все, кроме `auth/*`, требуют сессию
(`requireUser()` → 401). Ошибки отдаются JSON `{ error: string }`.

### Аутентификация

| Метод | Путь | Вход | Выход |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, password, name?}` | `{user:{id,email,name,language,role}}` + cookie |
| POST | `/api/auth/login` | `{email, password}` | `{user:{...}}` + cookie |
| POST | `/api/auth/logout` | — | `{ok:true}`, cookie сброшена |
| GET | `/api/auth/me` | — | `{user:{...} \| null}` |

Проверки регистрации: email по regex, пароль ≥ 6 символов, уникальность email (409).

### Онбординг и состояние

| Метод | Путь | Вход | Выход |
|---|---|---|---|
| POST | `/api/onboarding` | `{statement, level, hoursPerWeek, lang}` | `{goalId, spec}` (роадмап ещё не создан) |
| GET | `/api/state` | — | цель, иерархический роадмап с `skillStatus`, `summary` (векторы, счётчики, доказательства, события, рекомендации), `misconceptions`, `nextBest`, `domainStats`, `materialCount`, `goalMetrics` |
| GET | `/api/recommend?roadmapId=` | — | `{next, queue}` |
| GET | `/api/roadmap?goalId=` | — | `{roadmap}` (дерево узлов) |
| GET | `/api/skills` | — | `{domains, skills[]}` — метрики с `null` = «не оценено» |
| POST | `/api/roadmap/substeps` | `{nodeId, lang, count?}` | `{created[]}` — генерация/сохранение подшагов узла (идемпотентно: `[]`, если подшаги уже есть) |
| POST | `/api/roadmap/ensure` | `{goalId, lang, force?}` | `{ready, roadmapId}` — строит план, если его ещё нет (`force` — перестроить) |

`goalMetrics` — кольца на главной: считаются по **навыкам текущего пункта плана**
(`active`, иначе `ready`), с фолбэком на целевые навыки цели, если текущего пункта нет.

### Диагностика

| Метод | Путь | Вход | Выход |
|---|---|---|---|
| POST | `/api/diagnostic/start` | `{goalId, lang}` | `{ladder[], index, question}` (без ключа ответа) |
| POST | `/api/diagnostic/answer` | `{goalId, ladder, index, questionId, skillId, selectedIndex, confidence, lang}` | `{done, correct, feedback, next}` — вердикт немедленно, без LLM |
| POST | `/api/diagnostic/next` | `{skillId, level, lang}` | `{question}` — следующий вопрос адаптивной диагностики |

### Обучение

| Метод | Путь | Вход | Выход |
|---|---|---|---|
| POST | `/api/learn` | `{itemId, lang}` | `{item, lesson{body,sources,grounded}, task{statement,starterCode,hints,example,testCount}, competency}` |
| POST | `/api/run` | `{code, input}` | `{ok, stdout, stderr, timedOut, durationMs}` |
| POST | `/api/attempt` | `{taskId, roadmapItemId, code, hintsUsed, confidence, timeSpentSeconds, lang}` | `{passed,total,passedAll,feedback,testResults,competency,method}` |
| POST | `/api/tutor` | `{message, conversationId?, roadmapItemId?, taskId?, code?, lang}` | `{conversationId, intent, actionType, reply, misconceptionCode, goalId?, action?}` |

### Диалоги тьютора

| Метод | Путь | Вход | Выход |
|---|---|---|---|
| GET | `/api/tutor/conversations` | — | `{conversations[], activeId}` |
| POST | `/api/tutor/conversations` | — | `{conversation}` (новая, предыдущая архивируется) |
| GET | `/api/tutor/conversations/:id` | — | `{conversation, messages[]}` (ownership, иначе 404) |

### Материалы и админ

| Метод | Путь | Вход | Выход |
|---|---|---|---|
| POST | `/api/materials` | `FormData: file[, scope=global]` | `{id, filename, scope, chunkCount, summary, skillIds, …}` |
| GET | `/api/materials` | — | `{isAdmin, materials[]}` (свои + глобальные; `mimeType`, `provenance`) |
| DELETE | `/api/materials/:id` | — | `{ok}` (владелец или админ, иначе 403) |
| GET | `/api/admin/overview` | — | `{students[], totals{}}` (только `role: admin`, иначе 403) |

Ограничения загрузки: 100 МБ, расширения `txt/md/text/csv/json/pdf/docx`, минимум 40 символов
извлечённого текста.

---

## 14. Фронтенд

### Маршруты

| Путь | Тип | Guard |
|---|---|---|
| `/` | server | редирект: сессия → `/home`, иначе → `/login` |
| `/login`, `/register` | server + client-форма | если сессия есть → `/home` |
| `/admin` | server | `role === "admin"`, иначе → `/home` |
| `(app)/layout.tsx` | server | нет сессии → `/login`; оборачивает в `AppShell` |
| `/tutor` | client | — (первый пункт навигации) |
| `/home` | server + client | нет цели → `/tutor`; нет роадмапа или диагностики → `/diagnostic?goalId=` |
| `/roadmap` | client | иерархический план с раскрытием подшагов |
| `/learning` | server + client | единый Learning hub: секции Overview / Materials |
| `/materials` | server | редирект на `/learning?tab=materials` (совместимость) |
| `/learn/[itemId]` | server (params) + client | каркас; `/api/learn` проверяет владение узлом |
| `/onboarding` | server + client | есть цель → `/home` |
| `/diagnostic` | server + `Suspense` | каркас |

`(app)` — route group: не влияет на URL, но даёт общий каркас (сайдбар, аккаунт, язык) и
монтирует **FloatingTutor** на всех авторизованных страницах (§48).

### Состояние

Авторитетное состояние — только на сервере. Клиент держит локальный `useState` и получает данные
через `fetch` из `/api/*`. В `localStorage` лежит **единственная** вещь — выбранный язык
(ключ `zk_lang`).

### i18n

- `src/lib/i18n.ts` — словари `en` / `ru` (плоские ключи вида `nav.tutor`, `metric.knowledge`);
- `src/components/i18n.tsx` — `I18nProvider` + `useI18n()` → `{lang, setLang, toggle, t}`;
- переключатель — `ui/language-toggle.tsx` (в сайдбаре, на страницах входа и онбординга);
- язык **передаётся в теле запроса** на генерацию, поэтому уроки, задачи, диагностика и тьютор
  отвечают на выбранном языке (в промпт добавляется `langInstruction`).

### Компоненты

`ui/` — `logo`, `spinner`, `progress-ring` (анимированное кольцо на framer-motion), `markdown`
(react-markdown + prose-стили), `reveal` (появление при скролле), `language-toggle`.
`shell/app-shell.tsx` — сайдбар с активным индикатором (`layoutId`), мобильный топбар, блок
аккаунта (имя, email, язык, выход).
Фичи — `auth/`, `onboarding/`, `diagnostic/`, `home/`, `roadmap/`, `learn/`, `tutor/`,
`learning/`, `materials/`, `admin/`.

### Дизайн-система

Токены — в `src/app/globals.css` (CSS-переменные) и `tailwind.config.ts` (цвета `ink`, `text`,
`accent`, `cyan`, `mint`, `amber`, `rose`; анимации `shimmer`, `float-slow`, `pulse-glow`).
Утилиты: `.glass`, `.card`, `.btn-primary`, `.btn-ghost`, `.input`, `.chip`, `.eyebrow`,
`.gradient-text`, `.prose-lip`. Фон — два фиксированных слоя: радиальный градиент и сетка с маской.

---

## 15. Поток пользователя end-to-end

### 15.1 Регистрация / вход

`POST /api/auth/register` → `User` + `Learner` (id = user.id) → cookie `zk_session` →
редирект: админ → `/admin`, ученик → `/tutor`.

**Записи:** `User`, `Learner`.

### 15.2 Постановка цели через тьютора

Ученик без цели пишет в тьютор. < 12 символов → `clarify_goal` (цель не создаётся).
Иначе: `compileGoal` → `Goal` + `GoalSkill` + событие `goal_created`; в ответе `goalId` →
в интерфейсе появляется кнопка перехода к диагностике.

**Записи:** `Message` ×2, `Goal`, `GoalSkill[]`, `LearningEvent`.

### 15.3 Диагностика → генерация плана

`POST /api/diagnostic/start` → лестница → первый вопрос (+ `DiagnosticQuestion`).
На каждый ответ: сверка с ключом из БД → `Evidence` (+ `LearningEvent` калибровки) →
`applyEvidence` → `CompetencyState` (+ `Misconception` при ошибке) → вердикт → «Далее».
На последнем ответе: `buildRoadmapFromGoal` → `Roadmap` + `RoadmapItem[]` + событие
`diagnostic_completed`.

**Ключевая идея:** план генерируется **после** измерения, поэтому он учитывает уже известное
мастерство (TTЗ §29–30).

### 15.4 Главная

`GET /api/state` + `recommendNext` → «что делать дальше» с обоснованием; кольца — по навыкам
текущего пункта плана; CTA на `/learn/[itemId]`.

### 15.5 Учебная сессия

`POST /api/learn` → (при необходимости) генерация урока с grounding + задача с валидацией
исполнением → Monaco → «Запустить» (`/api/run`) → «Отправить» (`/api/attempt`) →
детерминированная проверка → AI-разбор при провале → `Evidence` → обновление вектора →
при полном успехе без подсказок пункт закрывается, открывается следующий.

### 15.6 Материалы

`POST /api/materials` (FormData) → извлечение → чанки → анализ → `Material` + `MaterialChunk`.
Админ грузит со `scope=global` — эти материалы доступны всем ученикам при генерации уроков.

### 15.7 Админ

`/admin` — сводка по ученикам и загрузка общих материалов.

---

## 16. Обработка ошибок и отказоустойчивость

**`handle()`** (`src/lib/api.ts`) оборачивает все обработчики:

```ts
ApiError            → fail(message, status)          // 401/403/400
сообщение с AI|provider|timed out|Structured output → 502 (внешний сбой)
иначе               → 500
console.error(`[api] ${msg}`)                        // серверный лог
```

**Отказоустойчивость AI-слоя** (накопилась из реальных сбоев):

| Проблема | Решение |
|---|---|
| Пустой `content` при непустом `reasoning_content` | считается retryable |
| Таймауты, 429, 5xx | до 3 повторов с backoff `800ms × (i+1)` |
| Пустой вывод / битый JSON / несоответствие схеме | до 3 повторов всей `generateObject` |
| Код-блоки внутри JSON | балансный разбор с учётом строк (`extractJsonObject`) |
| Reasoning-модель «съедала» ответ | подняты `maxTokens` (8000–16000 для структурных вызовов) |
| Строгая схема не прошла | исключение с фрагментом ответа в тексте — видно, что именно вернула модель |

**Данные не теряются при сбое AI:** всё состояние в SQLite; провал генерации влияет только на
текущую операцию. Диагностика переживает перезапуск (ключи в БД). Прерванная диагностика
начинается заново без порчи состояния (доказательства пишутся только при ответе).

---

## 17. Безопасность и приватность

| Область | Реализация |
|---|---|
| Пароли | scrypt + случайная соль, сравнение через `timingSafeEqual` |
| Сессия | HMAC-SHA256, `httpOnly`, `sameSite=lax`, срок 30 дней |
| Изоляция | все запросы фильтруются по `learnerId` из подписанной сессии |
| Права | `requireUser()` (401), роль `admin` для админ-эндпоинта (403) |
| Ответы модели | обязательная Zod-валидация перед записью в состояние |
| Исполнение кода | отдельный процесс, временная папка, таймаут 8 c, без доступа к данным приложения |
| Секреты | `.env.local` (gitignored); в репозитории только `.env.example` |
| Приватные данные | `dev.db` и `storage/` в `.gitignore` |
| Оценка | ключ ответа диагностики не уходит на клиент; AI не переопределяет результат тестов |

---

## 18. Известные ограничения и что дальше

Раздел намеренно честный.

### Архитектурные упрощения

1. **Нет мультиагентного фреймворка.** «Агенты» — это специализированные роли: функция + промпт +
   Zod-схема. Оркестратор — детерминированный код. Нет `LangGraph`/`PydanticAI`, нет автономных
   циклов Observe→Act→Verify.
2. **`LLM_PROVIDER` не читается кодом** — адаптер жёстко `openai-compatible`. Смена провайдера
   делается через `LLM_BASE_URL` / `LLM_API_KEY` / модели.
3. **Retrieval без эмбеддингов** — лексическое пересечение токенов. Нет `pgvector`.
4. **Долгие операции в рамках запроса** — нет очередей/`Temporal`; ограничения
   `maxDuration`: `tutor`/`attempt` 60 c, `materials` 120 c, `run` 30 c.
5. **Изоляция кода — уровень подпроцесса**, не контейнер/gVisor. Для прода нужен контейнерный
   sandbox с лимитами CPU/памяти/сети.
6. **SQLite** — не Postgres; JSON-поля вместо связующих таблиц.
7. **Формальные тесты — только для чистого ядра.** `node --import tsx --test` покрывает
   `mastery`/`competency`/`evidence`/`roadmap` (50 тестов); e2e — `scripts/upgrade-smoke.mjs`.
   Для Prisma-зависимых сервисов отдельных unit-тестов нет.
8. **Нет rate limiting, подтверждения email, сброса пароля, 2FA.**

### Образовательные пробелы

9. **Планировщик повторений — частичный.** `retentionEstimate` + `retentionDue` считаются и
   показываются в UI, но интервальные повторения по расписанию не ставятся автоматически.
10. **Нет интерливинга** — смешивание навыков в одной сессии не реализовано.
11. **Перенос исправлен, но строг:** обычная практика имеет `transferLevel=0.1` (порог 0.4), поэтому
    transfer двигают только `transfer`/`project`-задачи; шаг +0.2 за успех (замедлен против прежнего).
12. **`application`, `supportDependence` и `retention` считаются ядром** и отдаются через API
    (`/api/state`, `/api/skills`), но отдельной вкладки прогресса в UI больше нет;
    остаётся не показывать полную историю изменений вектора во времени.
13. **Задачи только по Python**; нет статического анализа/AST и оценки сложности.
14. **Нет дашборда учителя** — только админская сводка.
15. **Материалы не «усваиваются» в граф** — покрытие навыков хранится у материала, но новых узлов
    графа из документа не создаётся.
16. **i18n покрывает интерфейс**; служебные строки в логах и часть подписей — на английском.
17. **Retrieval-история тьютора лексическая** (keyword), а не семантическая (§60).

### Ближайшие разумные шаги

Планировщик повторений (retention → расписание); интерливинг; эмбеддинги + `pgvector` для
retrieval (материалов и истории диалога); контейнерный sandbox; unit-тесты для Prisma-сервисов
(roadmap-редактирование, tutor-действия).

---

## 19. Рецепты расширения

### Добавить навык или домен

1. Домен — в `DOMAINS` (`knowledge-graph.ts`) и в `src/lib/seed-shared.ts` (для seed).
2. Навык — в `SKILLS` (оба файла) с `prerequisites`.
3. `pnpm db:seed` — обновит таблицу `Skill`.

### Добавить заблуждение

Запись в `MISCONCEPTION_CATALOG` (код + затронутые навыки + correction). LLM начнёт использовать код
в дистрикторах диагностики, а движок — отслеживать состояние.

### Добавить или изменить промпт

1. Запись в `PROMPTS`; при изменении поведения существующего — **поднять `version`**.
2. Использовать через `getPrompt("id")` + `generateObject(generateText)`.

### Добавить эндпоинт

```ts
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();     // изоляция
    const body = await req.json();
    return doWork({ learnerId: userId, ...body });
  });
}
```

### Изменить поведение обновления вектора

Правила собраны в одном месте — `applyEvidence` (`student-twin.ts`). Математика мастерства —
`mastery.ts` (`updateMastery`, `supportTier`).

---

## 20. Связанные документы

- `README.md` — обзор, быстрый старт, гарантии.
- `docs/ADR-001-modular-monolith.md` — почему один Next.js-процесс, а не микросервисы.
- `docs/ADR-002-provider-abstraction.md` — провайдер-абстракция и роутинг по capability.
- `docs/ADR-003-learning-state-and-mastery.md` — состояние как источник истины, бета-модель.
- `docs/ADR-004-deterministic-verification-first.md` — почему исполнение важнее интерпретации.
- `docs/ADR-005-content-provenance-and-enrichment.md` — provenance и grounding.
- `scripts/smoke.mjs` — исполняемая проверка: админ → общий материал → ученик → цель →
  диагностика → план → урок с grounding → изоляция.
