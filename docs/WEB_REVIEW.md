# WEB_REVIEW — руководство по ручному обзору Web-интерфейса

Документ фиксирует состояние окружения, подготовленного для ручного изучения существующего интерфейса LearnHouse. Решения об удалении или упрощении функциональности здесь не принимаются.

## 1. Статус этапа

| Критерий | Статус |
|---|---|
| Web открывается локально | ✅ `http://localhost:3000` |
| API и БД работают | ✅ API `http://localhost:1338`, PostgreSQL, Redis |
| Collab (доски) запущен | ✅ `ws://localhost:4000` |
| Основные страницы отвечают | ✅ проверены ключевые публичные и dashboard-маршруты |
| Тестовые аккаунты | ✅ admin, instructor, student |
| Демонстрационные данные | ⚠️ минимальный набор (курс, глава, активность, сообщество, доска) |
| EE-функции | ❌ недоступны (OSS-сборка без `apps/api/ee` и `apps/web/ee`) |

Окружение поднято заново из текущего checkout. Старые контейнеры `zerok-*` остановлены и не используются.

## 2. Параметры окружения

| Компонент | Адрес/порт | Примечание |
|---|---|---|
| Web (Next dev) | http://localhost:3000 | Next.js 16.4.5, Turbopack |
| API (FastAPI) | http://localhost:1338 | `uvicorn` через `uv run python app.py` |
| Collab (Hocuspocus) | ws://localhost:4000 | Node/tsx, Yjs |
| PostgreSQL | 127.0.0.1:55432 | `pgvector/pgvector:pg16`, БД `learnhouse` |
| Redis | 127.0.0.1:6379 | `redis:7.4-alpine` |
| Content | `apps/api/content` | filesystem storage |
| Judge0 | — | не запущен |
| Email | — | Resend/SMTP не настроены |

Версии: Bun 1.4.4, Node 22.22.2, Python 3.14.7 (через uv 0.12.19), Docker 29.7.2.

Ветка: `web-phase-1-exploration` (создана от `main`). Исходный код приложения не изменялся; добавлены только документы.

## 3. Локальные аккаунты

Все аккаунты созданы в локальной БД для обзора. **Это не production-учётки.** После завершения обзора пароли следует сменить или удалить аккаунты.

| Роль | Email | Пароль | Права |
|---|---|---|---|
| Admin / superadmin | `admin@school.dev` | `ReviewPhase1!2026` | Полный доступ к организации; `is_superadmin=true`; платформенная `/admin` в OSS закрыта EE-гейтом |
| Instructor (преподаватель) | `instructor@example.com` | `InstructorPhase1!2026` | Dashboard, создание/редактирование собственных курсов и активностей, задания, доски, свои подкасты/playgrounds |
| User (студент) | `student@example.com` | `StudentPhase1!2026` | Публичный контент, `/account`, `/calendar`, `/trail`, участие в обсуждениях; **нет доступа к `/dash`** |

Пароль bootstrap-админа также задан переменной `LEARNHOUSE_INITIAL_ADMIN_PASSWORD` процесса API. В отчётах и репозитории других секретов нет.

### Роли в проекте

`apps/api/src/services/setup/setup.py` создаёт четыре глобальные роли:

| ID | Роль | Назначение | Dashboard |
|---|---|---|---|
| 1 | Admin | Полный контроль, настройки организации, пользователи, роли | да |
| 2 | Maintainer | Широкие права на контент, пользователей (без delete), роли (read), организации (read) | да |
| 3 | Instructor | Собственный контент, задания, доски, подкасты, playgrounds | да |
| 4 | User | Read-only обучение, обсуждения | **нет** |

`AdminAuthorization` проверяет `dashboard.action_access`; для User он `false`, поэтому `/dash*` после гидратации показывает 403-экран, хотя HTTP-ответ страницы — 200.

## 3.1 Модель входа (реализовано)

- На любой URL без сессионной cookie прокси отвечает редиректом на `/login`; других публичных страниц нет.
- `/login` — обычный вход по e-mail и паролю для уже созданных аккаунтов.
- `/register` — свободная регистрация: имя, e-mail (любой домен) и пароль. Новый аккаунт сразу активен, автоматически получает роль студента и попадает в `/cabinet`; почтового подтверждения и одобрения нет.
- После входа: `admin`/`teacher` → `/dash`, `student` → `/cabinet`.
- Google OAuth и старый `/api/signup` отключены: на платформу можно попасть только через `/login` или `/register`.
- Роль `Maintainer` удалена из базы и сидирования; в системе три роли: Admin, Instructor (teacher), User (student).

Проверенные тестовые аккаунты:

| Роль | Email | Пароль |
|---|---|---|
| Instructor (teacher) | `finalcheck@gmail.com` | `FinalCheck1!` |
| Student (user) | `candidate@gmail.com` | `CandidatePhase1!2026` |

Локальные пароли также остаются у admin/instructor/student из таблицы выше.

## 4. Подготовленные данные

Организация: `default` — «ZeroKnowledge Academy».

| Объект | Значение | URL для обзора |
|---|---|---|
| Курс | `Review Course: Platform Tour` | `/course/course_827ab2b5-4dea-43ff-839d-a37a57c36241` |
| Глава | `Chapter 1: Getting Around` | внутри курса |
| Активность | `Welcome page` (TYPE_DYNAMIC / SUBTYPE_DYNAMIC_PAGE) | `/course/course_827ab2b5-4dea-43ff-839d-a37a57c36241/activity/activity_25f41716-65e6-45ef-b359-4a316507c366` |
| Сообщество | `Review Community` | `/community/community_422fdcef-0ecd-4268-9b9d-a68ae40f21d7` |
| Доска | `Review Board` (public) | `/board/board_7cce1f1e-b294-471e-98eb-b707f1f38ebd` |

Чего нет в подготовленном наборе:

- задания и сабмиты (создаются в `/dash/assignments` или из структуры курса);
- подкаст и эпизоды (нужен аудиофайл);
- learning path (создаётся в `/dash/paths`);
- playground (создаётся в `/dash/playgrounds`; AI-генерация выключена);
- сертификаты (появляются после настройки и завершения курса);
- платежи, live-сессии, org analytics, audit logs, SSO, LTI, SCORM — EE-only;
- сообщения — backend messaging отключён в OSS.

## 5. Порядок ручного осмотра

### Этап A. Неавторизованный пользователь

Цель: оценить публичный контур, навигацию, SEO-оболочку и поведение ограниченного доступа.

1. `/` — домашняя страница организации: лендинг, блоки, курсы, сообщества.
2. `/courses` — каталог: поиск, пагинация, карточки, пустые состояния.
3. `/course/course_827ab2b5-4dea-43ff-839d-a37a57c36241` — страница курса, дерево глав, старт.
4. `/course/.../activity/activity_25f41716-65e6-45ef-b359-4a316507c366` — плеер активности.
5. `/communities` и `/community/community_422fdcef-0ecd-4268-9b9d-a68ae40f21d7` — каталог и сообщество; создание темы попросит вход.
6. `/boards` и `/board/board_7cce1f1e-b294-471e-98eb-b707f1f38ebd` — публичная доска (realtime).
7. `/library` — библиотека.
8. `/podcasts`, `/playgrounds`, `/paths` — каталоги и пустые состояния.
9. `/search` — поиск по организации.
10. `/user/admin` — публичный профиль.
11. `/login`, `/signup`, `/forgot` — формы и валидация.
12. `/admin` — в OSS должен показать экран «требуется Enterprise Edition».

Что проверить: шапка/меню, мобильная навигация, переключатель языка, command palette, футер, watermark, поведение при отсутствии данных.

### Этап B. Студент (`student@example.com`)

После входа студент попадает в `/cabinet` — лёгкий кабинет с курсами, прогрессом, дедлайнами и ссылками на аккаунт. Пункт «My learning» также есть в меню профиля.

1. `/cabinet` — сводка обучения.
2. `/account`, `/account/general`, `/account/profile`, `/account/security`, `/account/ai-apps`.
2. `/calendar` — дедлайны/события.
3. `/trail` — лента обучения.
4. Курс и активность: прогресс, завершение, возврат.
5. `/community/...` — создание обсуждения, комментарий, голос, реакция.
6. `/dash` — должен показать отказ (403 UI) после загрузки клиента.
7. `/messages` — страница откроется, но backend messaging в OSS отключён; зафиксировать поведение.

Чего не хватает для полноты: задания с дедлайном и сабмитом; сертификат; платный контент (EE). Их можно создать через админский аккаунт.

### Этап C. Преподаватель (`instructor@example.com`)

1. `/dash` — главная, usage, недавние курсы/участники, onboarding.
2. `/dash/courses` — создание, поиск, клонирование, экспорт.
3. `/dash/courses/course/827ab2b5-4dea-43ff-839d-a37a57c36241/{general,content,schedule,access,contributors,seo,certification}` — вкладки курса.
4. `/dash/courses/migrate` — AI-миграция (ожидаемо недоступна без AI).
5. Редактор активности: `/course/.../activity/.../edit` или `/editor/course/...`.
6. `/dash/assignments` — создание задания, задачи, публикация; проверка сабмитов.
7. `/dash/library` — папки, загрузка, сортировка.
8. `/dash/boards` и настройки доски.
9. `/dash/communities` — Instructor имеет read-only по communities; создание/модерация ожидаемо недоступны.
10. `/dash/paths`, `/dash/podcasts`, `/dash/playgrounds` — проверить права Instructor и пустые состояния.
11. `/dash/users/settings/*` и `/dash/org/settings/*` — ожидаемо ограничены (нет прав users/organizations update).

### Этап D. Администратор (`admin@school.dev`)

1. `/dash/users/settings/users` — участники, роли, удаление, приглашения.
2. `/dash/users/settings/{signups,add,usergroups,roles,sign-in,two-factor,audit-logs}` — управление доступом. `audit-logs` — EE.
3. `/dash/org/settings/{general,features,branding,menu,landing,course-end,ai,usage,other,danger}` — конфигурация организации.
4. `/dash/developers/{mcp,api,automations,domains,seo,sso,lti}` — API-токены, webhooks, домены, MCP, SEO; SSO/LTI — EE.
5. `/dash/courses/.../analytics`, `/dash/analytics`, `/dash/payments/*`, `/dash/live-sessions*`, `/dash/atlas` — зафиксировать EE-заглушки.
6. `/dash/onboarding` — Launch plan.
7. `/admin` — платформенная админка; в OSS закрыта.

### Этап E. Maintainer (опционально)

Роль существует, но отдельный аккаунт не создан. Если нужно сравнить: администратор может создать пользователя и назначить роль `Maintainer` в `/dash/users/settings/users` (или через API `PUT /orgs/{id}/users/{uid}/role/role_global_maintainer`). Ожидаемое отличие: широкие права на контент, но организации — read-only, роли — read-only, удаление пользователей недоступно.

## 6. Назначение разделов (кратко)

| Раздел | Назначение |
|---|---|
| `/courses` | Каталог обучения; точка входа студента |
| `/course/...` | Программа курса, прогресс, сертификат, обновления |
| `/course/.../activity/...` | Проигрывание конкретной активности (page/video/pdf/assignment/SCORM/live) |
| `/paths` | Последовательности курсов |
| `/library` | Общие папки и медиа организации |
| `/communities` | Обсуждения, Q&A, анонсы |
| `/boards` | Совместные доски (Yjs) |
| `/playgrounds` | Интерактивные AI-элементы |
| `/podcasts` | Аудиоконтент и RSS |
| `/live` | Live-сессии (EE) |
| `/store` | Продажа доступа (EE) |
| `/messages` | Личные/групповые сообщения (EE-backend) |
| `/calendar` | Персональный календарь событий |
| `/trail` | Лента учебной активности |
| `/copilot` | AI-помощник по контенту (AI выключен) |
| `/account` | Профиль, безопасность, покупки, AI-приложения |
| `/dash` | Рабочее место преподавателя/администратора |
| `/dash/courses` | Управление курсами и структурой |
| `/dash/assignments` | Авторинг и проверка заданий |
| `/dash/library` | Управление файлами и папками |
| `/dash/communities` | Управление сообществами и модерацией |
| `/dash/boards` | Управление досками и участниками |
| `/dash/paths` | Управление learning paths |
| `/dash/podcasts` | Управление подкастами и эпизодами |
| `/dash/playgrounds` | Управление интерактивными элементами |
| `/dash/users/settings` | Люди, группы, роли, доступ, 2FA |
| `/dash/org/settings` | Брендинг, меню, лендинг, фичи, usage |
| `/dash/developers` | API, webhooks, домены, MCP, SEO |
| `/admin` | Платформенное управление (EE/SaaS) |
| `/oauth/consent`, `/oauth/approve` | Подключение внешних AI-приложений по MCP |

## 7. Ограничения текущего окружения

| Ограничение | Причина | Что нужно для полного просмотра |
|---|---|---|
| Org analytics, audit logs, user analytics | EE-only | EE-сборка + лицензия; либо не рассматривать в OSS |
| Payments, store, paywalls | EE-only | EE + Stripe |
| Live sessions и комнаты | EE-only + LiveKit | EE + live-провайдер |
| SSO, LTI, SCORM | EE-only | EE-конфигурация |
| `/admin` | EE-гейт в `app/admin/layout.tsx` | EE/SaaS |
| AI-генераторы, copilot, Atlas, AI-миграция | `LEARNHOUSE_IS_AI_ENABLED=false` | Ключ провайдера (Gemini/OpenAI/...), включить AI |
| Выполнение кода, CODE-задания | Judge0 не запущен | Judge0 |
| Email: приглашения, reset, verification, magic link | Нет Resend/SMTP | Настроить провайдера |
| Почтовое подтверждение при регистрации | Не требуется: аккаунт активируется сразу | — |
| Turnstile, Loops, PostHog, Sentry | Нет ключей | Ключи соответствующего сервиса |
| Messaging | `messaging` — EE-only в `deployment_mode.py` | EE/SaaS |
| HLS/транскодирование | Отключено по умолчанию (`LEARNHOUSE_HLS_ENABLED`) | Включить и настроить worker |
| Пустые каталоги | Минимальный seed | Создать данные через UI или использовать demo stack |
| Язык интерфейса | Определяется локалью/настройкой | Переключатель языка в шапке/auth-экранах |

HTTP-статус 200 не гарантирует наличие контента: дашборды и каталоги рендерятся клиентски, а EE-заглушки могут отдавать пустой экран. Оценивайте в браузере с включённым JavaScript.

## 8. Проверенные точки

На момент подготовки отчёта:

- `/`, `/login`, `/signup`, `/courses`, `/communities`, `/boards`, `/paths`, `/podcasts`, `/playgrounds`, `/library`, `/calendar`, `/trail`, `/copilot`, `/account`, `/admin` — отвечают 200.
- `/home` — 307 (single tenancy редиректит на `/`).
- Созданный курс, глава, активность, сообщество, доска — доступны по прямым URL (200).
- Вход через `http://localhost:3000/api/auth/login` устанавливает `LH_access`/`LH_refresh`; `/users/session` возвращает администратора.
- API health: `http://localhost:1338/api/v1/health` → `true`; web health: `/api/health` → `healthy`.

## 9. Как перезапустить окружение

Команды приведены для PowerShell. Файлы конфигурации не создаются; все параметры передаются переменными окружения.

### 9.1 PostgreSQL и Redis

```powershell
docker rm -f lh-review-db lh-review-redis
docker run -d --name lh-review-db `
  -e POSTGRES_USER=learnhouse -e POSTGRES_PASSWORD=learnhouse -e POSTGRES_DB=learnhouse `
  -p 127.0.0.1:55432:5432 -v lh-review-db-data:/var/lib/postgresql/data `
  pgvector/pgvector:pg16

docker run -d --name lh-review-redis `
  -p 127.0.0.1:6379:6379 -v lh-review-redis-data:/data `
  redis:7.4-alpine redis-server --appendonly yes
```

Порт 5432 в этой системе занят исключённым диапазоном Windows, поэтому используется 55432.

### 9.2 API

```powershell
cd apps/api
$env:LEARNHOUSE_SQL_CONNECTION_STRING='postgresql://learnhouse:learnhouse@127.0.0.1:55432/learnhouse'
$env:LEARNHOUSE_REDIS_CONNECTION_STRING='redis://127.0.0.1:6379/0'
$env:LEARNHOUSE_AUTH_JWT_SECRET_KEY='review-phase1-jwt-secret-0123456789abcdef'
$env:COLLAB_INTERNAL_KEY='review-phase1-collab-key-0123456789abcdef'
$env:LEARNHOUSE_DEVELOPMENT_MODE='true'
$env:LEARNHOUSE_TENANCY='single'
$env:LEARNHOUSE_DOMAIN='localhost:3000'
$env:LEARNHOUSE_FRONTEND_DOMAIN='localhost:3000'
$env:LEARNHOUSE_PORT='1338'
$env:LEARNHOUSE_ALLOWED_ORIGINS='http://localhost:3000'
$env:LEARNHOUSE_INITIAL_ADMIN_EMAIL='admin@school.dev'
$env:LEARNHOUSE_INITIAL_ADMIN_PASSWORD='ReviewPhase1!2026'
$env:LEARNHOUSE_INITIAL_ORG_NAME='ZeroKnowledge Academy'
$env:LEARNHOUSE_INITIAL_ORG_SLUG='default'
$env:LEARNHOUSE_DISABLE_EE='1'
$env:LEARNHOUSE_IS_AI_ENABLED='false'
& "$env:USERPROFILE\.local\bin\uv.exe" run python app.py
```

`LEARNHOUSE_INITIAL_*` действуют только при пустой БД (auto-install). Секреты — локальные; не использовать в production.

### 9.3 Web

```powershell
cd apps/web
$env:NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL='http://localhost:1338'
$env:NEXT_PUBLIC_LEARNHOUSE_API_URL='http://localhost:1338/api/v1/'
$env:NEXT_PUBLIC_LEARNHOUSE_DOMAIN='localhost:3000'
$env:NEXT_PUBLIC_LEARNHOUSE_HTTPS='false'
$env:NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG='default'
$env:NEXT_PUBLIC_COLLAB_URL='ws://localhost:4000'
$env:LEARNHOUSE_INTERNAL_API_URL='http://127.0.0.1:1338'
$env:PORT='3000'
bun run dev
```

`LEARNHOUSE_INTERNAL_API_URL` обязателен на Windows: `localhost` резолвится в IPv6, а API слушает IPv4.

### 9.4 Collab

```powershell
cd apps/collab
$env:COLLAB_PORT='4000'
$env:LEARNHOUSE_API_URL='http://127.0.0.1:1338'
$env:LEARNHOUSE_AUTH_JWT_SECRET_KEY='review-phase1-jwt-secret-0123456789abcdef'
$env:COLLAB_INTERNAL_KEY='review-phase1-collab-key-0123456789abcdef'
$env:LEARNHOUSE_REDIS_URL='redis://127.0.0.1:6379'
bun run dev
```

### 9.5 Остановка

```powershell
docker stop lh-review-db lh-review-redis
# Процессы Web/API/Collab завершаются по Ctrl+C в своих терминалах.
```

## 10. Альтернатива: demo stack с полными данными

В репозитории есть документированный сценарий `DEMO_STACK.md`: API запускается в multi-tenancy/SaaS с `LEARNHOUSE_DEMO_ENABLED=1` и создаёт организацию `demo` с курсами, заданиями, сообществом, досками, подкастами и магазином. Это **другой режим** (multi tenancy, SaaS, demo-организация), поэтому он не заменяет текущий OSS-обзор, а дополняет его.

Особенности demo stack:

- требует `lvh.me` (резолвится в 127.0.0.1) и web на `:3010`;
- демо-данные автоматически восстанавливаются каждые 10 минут;
- платежи/аналитика всё равно требуют EE;
- секреты генерируются в `.demo-secrets` (gitignored).

Если нужен обзор с богатым набором данных, его лучше запускать отдельным окружением, не смешивая с текущей OSS-базой.

## 11. Чек-лист владельца проекта

- [ ] Пройти этап A (аноним) и отметить непонятные/лишние экраны.
- [ ] Пройти этап B (студент) и проверить обучение, прогресс, обсуждения.
- [ ] Пройти этап C (преподаватель) и проверить создание курса, структуру, активности, задания.
- [ ] Пройти этап D (администратор) и проверить людей, роли, группы, настройки, developers.
- [ ] Отдельно зафиксировать EE-разделы, которые недоступны в OSS.
- [ ] Составить список функций, которые нужно сохранить, упростить или убрать (следующий этап, не сейчас).

## 12. Важное предупреждение

Текущее окружение — локальное, с тестовыми данными и тестовыми паролями. Оно не предназначено для публикации в интернет. Не используйте эти учётные данные и секреты в production; не переносите демонстрационную БД в реальную инсталляцию.
