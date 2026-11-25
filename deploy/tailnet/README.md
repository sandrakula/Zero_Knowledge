# Стенд через Tailscale: для своих и по публичной ссылке

Приложение целиком (Next.js + FastAPI + collab-сервер + nginx) крутится в
одном контейнере на этой машине, рядом Postgres и Redis. Порт приложения
привязан к `127.0.0.1`, наружу его открывает только Tailscale:

- `./serve.ps1` — **serve**: `https://<машина>.<твой-tailnet>.ts.net`
  открывается только у устройств в твоём tailnet;
- `./serve.ps1 -Public` — **funnel**: тот же адрес, но доступен из интернета,
  другу достаточно ссылки (Tailscale ему ставить не нужно).

```
гость по ссылке ────┐
коллега (Tailscale) ─┴─► https://zerok-pc.tailXXXX.ts.net
                              │  TLS на этой машине
                              ▼
                       127.0.0.1:8080 (nginx в контейнере)
                              ├─ /            Next.js
                              ├─ /api/v1      FastAPI
                              ├─ /collab      collab (WebSocket)
                              ├─ db           postgres + pgvector
                              └─ redis
```

## Что нужно

| | |
|---|---|
| Docker Desktop | в Linux-контейнерах, ~10 ГБ свободного диска на образ |
| Tailscale | `winget install Tailscale.Tailscale`, вход в свой tailnet |
| Память | ~2.5–3 ГБ свободной RAM на стенд |
| Время | первая сборка 15–30 минут, дальше — только инкрементально |

## 1. Tailscale: включить HTTPS

1. Войди в [admin console → DNS](https://login.tailscale.com/admin/dns) и
   включи **MagicDNS** и **HTTPS Certificates**.
2. Проверь, что машина в сети и есть её DNS-имя:

```powershell
tailscale status --json | ConvertFrom-Json | % { $_.Self.DNSName }
# zerok-pc.tailXXXX.ts.net.
```

## 2. Пригласить коллег

Admin console → **Users → Invite users**. На бесплатном плане Personal можно
до 6 пользователей. Коллега принимает приглашение, ставит клиент Tailscale на
свою машину и входит — после этого ему открывается твой tailnet-адрес.

По умолчанию ACL разрешают участникам tailnet ходить на все устройства.
Если это лишнее — ограничь доступ в **Access controls**: например, разрешить
порты 443 только к этой машине.

## 3. Заполнить `.env`

```powershell
cd deploy/tailnet
Copy-Item .env.example .env
```

В `.env` обязательно:

- `TAILNET_HOST` — ровно то имя, что вывела команда из шага 1, без точки.
  Можно вписать одной командой из папки `deploy/tailnet`:

  ```powershell
  $h = (tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
  $p = Resolve-Path .env
  [IO.File]::WriteAllText($p, ([IO.File]::ReadAllText($p) -replace '(?m)^TAILNET_HOST=.*$', "TAILNET_HOST=$h"), (New-Object Text.UTF8Encoding($false)))
  ```
- `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`, `NEXTAUTH_SECRET`,
  `COLLAB_INTERNAL_KEY` — свои значения;
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — первый админ (создаётся один раз, пока
  база пустая). Email должен выглядеть настоящим: `.test`, `.example`,
  `.local` валидатор не принимает.

Секрет можно сгенерировать так:

```powershell
-join ((48..57)+(97..102) | Get-Random -Count 48 | % {[char]$_})
```

## 4. Собрать и поднять

Из папки `deploy/tailnet`:

```powershell
docker compose build          # первая сборка долгая, дальше кэш
docker compose up -d
docker compose logs -f app    # миграции и старт; ждём "Starting LearnHouse backend"
```

Проверка, что контейнер здоров (без авторизации):

```powershell
curl.exe -fsS http://127.0.0.1:8080/api/v1/health
```

## 5. Опубликовать в tailnet

```powershell
./serve.ps1
# Стенд доступен: https://zerok-pc.tailXXXX.ts.net/
```

Скрипт берёт имя машины из `tailscale status`, сверяет его с `TAILNET_HOST`
из `.env` и вызывает:

```powershell
tailscale serve --bg --https=443 http://127.0.0.1:8080
```

`--bg` переживает перезапуск Tailscale и перезагрузку. Полезное:

```powershell
tailscale serve status        # что опубликовано
./serve.ps1 -Off              # снять публикацию
```

## 5б. Публичная ссылка для друга (funnel)

Если другу нужно просто открыть ссылку в браузере — ставить Tailscale ему не
надо, но тогда стенд публикуется в интернет:

```powershell
./serve.ps1 -Public
# Публичная ссылка: https://zerok-pc.tailXXXX.ts.net/
```

Под капотом — `tailscale funnel --bg --https=443 http://127.0.0.1:8080`.
Адрес тот же, что у serve, поэтому `.env` менять не нужно: `TAILNET_HOST`,
`NEXTAUTH_URL` и `wss://…/collab` остаются валидными. Serve и funnel делят
порт 443, так что режим один из двух — `-Public` заменяет приватную публикацию.

**Первый запуск требует одного подтверждения.** Funnel по умолчанию выключен
в tailnet, и команда напечатает ссылку вида
`https://login.tailscale.com/f/funnel?node=…` — открой её и нажми
подтверждение. После этого `tailscale funnel` сам доедет до конца и напечатает
адрес. Разрешение даётся один раз на tailnet.

Что важно помнить:

- ссылку может открыть **любой**, кто её получил; защита — только логин в
  приложении. Заведи другу отдельного пользователя, а не отдавай `ADMIN_*`;
- проверь, что в организации выключена свободная регистрация, иначе по ссылке
  смогут завести аккаунты посторонние;
- у Funnel есть непубличные лимиты полосы, для теста это неважно;
- ссылка живёт, пока включён твой ПК, Docker и Tailscale. Нужен адрес, который
  работает без ноутбука, — это уже VM (Oracle Always Free и т.п.).

Снять: `./serve.ps1 -Off`, проверить: `tailscale funnel status`.

## 6. Проверка

1. Открой `https://<TAILNET_HOST>/` — должна открыться страница входа.
2. Залогинься под `ADMIN_EMAIL` / `ADMIN_PASSWORD` из `.env`.
3. Открой доску (Boards) — если она «connecting», значит collab не поднялся,
   смотри `docker compose logs app`.

> `http://127.0.0.1:8080` нужен только для health-проверок. Логин и всё
> остальное тестируй по `https://`-адресу из tailnet: ссылки, API-URL и
> `wss://…/collab` собраны под `TAILNET_HOST`, а через Serve куки ещё и
> получают флаг `Secure`.

## Обновления после правок в коде

```powershell
cd deploy/tailnet
docker compose build app && docker compose up -d app
```

Docker переиспользует слои: пересобирается только то, что изменилось (обычно
web-стадия). Пока идёт сборка, старый контейнер продолжает работать.

## Пересобрать базу пользователей с нуля

`reset-users.sql` удаляет всех пользователей вместе с их данными (прогресс,
сдачи, сертификаты, статистика, аудит, сообщения, MFA, токены). Курсы, главы,
активности, задания, программа и организация остаются; у контента, созданного
пользователями, ссылка на автора обнуляется (`SET NULL`).

```powershell
# 0. бэкап
docker compose exec -T db pg_dump -U learnhouse -d learnhouse --clean --if-exists -f /tmp/pre.sql
docker compose cp "db:/tmp/pre.sql" "backups/pre-$(Get-Date -Format yyyyMMdd-HHmmss).sql"

# 1. остановить приложение и вычистить пользователей
docker compose stop app
docker compose cp reset-users.sql "db:/tmp/reset-users.sql"
docker compose exec -T db psql -U learnhouse -d learnhouse -v ON_ERROR_STOP=1 -f /tmp/reset-users.sql
docker compose exec -T db rm -f /tmp/reset-users.sql

# 2. поднять приложение (миграции и сиды контента отработают сами)
docker compose start app

# 3. создать учётки из списка (users.local.json — в git не попадает)
docker compose cp seed-users.py "app:/app/api/seed-users.py"
docker compose cp users.local.json "app:/app/api/_users.json"
docker compose exec -T -w /app/api app /app/api/.venv/bin/python seed-users.py _users.json
docker compose exec -T app rm -f /app/api/seed-users.py /app/api/_users.json

# 4. сбросить кэш сессий и лимитов
docker compose exec -T redis redis-cli FLUSHALL
```

Формат `users.local.json` (роли: 1 — Admin, 3 — Instructor, 4 — User):

```json
[
  { "email": "admin@example.com", "username": "admin", "password": "...", "role_id": 1, "superadmin": true },
  { "email": "teacher@example.com", "username": "teacher", "password": "...", "role_id": 3 },
  { "email": "student@example.com", "username": "student", "password": "...", "role_id": 4 }
]
```

Образец — `users.example.json`. Скрипт идемпотентен: повторный запуск обновит
пароли и роли, а не создаст дубликаты.

## Сбросить прогресс, не трогая аккаунты
`reset-progress.sql` чистит только учебную активность: записи на курсы (trail),
пройденные шаги, сдачи заданий, сертификаты, аналитику и голоса. Пользователи,
пароли, курсы и доски остаются.

```powershell
docker compose cp reset-progress.sql "db:/tmp/reset-progress.sql"
docker compose exec -T db psql -U learnhouse -d learnhouse -f /tmp/reset-progress.sql
docker compose exec -T db rm -f /tmp/reset-progress.sql
```

## Остановка, сброс, бэкап
```powershell
docker compose stop            # остановить, данные остаются
docker compose down            # убрать контейнеры, данные остаются
docker compose down -v         # ПОЛНЫЙ сброс: база, redis и контент удаляются

# бэкап базы
docker compose exec db pg_dump -U learnhouse learnhouse > backup.sql
# восстановление
Get-Content backup.sql | docker compose exec -T db psql -U learnhouse -d learnhouse
```

## Если что-то не работает

| Симптом | Что проверить |
|---|---|
| Сайт не открывается, 502 | `docker compose ps`, `docker compose logs app`; healthcheck с `start_period: 90s` — первый старт долгий |
| Логин «не держится», кидает обратно | открываешь `http://127.0.0.1:8080` вместо `https://…ts.net` |
| Редиректы на `localhost` или битые ссылки | `TAILNET_HOST` в `.env` не совпадает с `Self.DNSName`; поправь и `docker compose up -d app` |
| Доски висят на «connecting» | collab упал (`docker compose logs app`), либо `NEXT_PUBLIC_COLLAB_URL` не `wss://…/collab` |
| `tailscale serve` / `funnel` ругается на сертификат | не включены HTTPS Certificates в admin console → DNS |
| Коллега не открывает адрес | он не принял приглашение / не вошёл в клиент / ACL закрывает доступ |
| По публичной ссылке ничего нет, а `-Public` запускался | Funnel не разрешён в policy (`nodeAttrs: funnel`): CLI должен был предложить включить; проверь `tailscale funnel status` |
| По публичной ссылке открывается, но логин не держится | в `.env` `TAILNET_HOST` не совпадает с `Self.DNSName`, поэтому куки и ссылки указывают на чужой хост |
| После перезагрузки ПК сайт лежит | не стартовал Docker Desktop; `tailscale serve status` / `tailscale funnel status` покажут, жива ли публикация |
| Ссылка умерла, когда ноутбук уснул | отключи сон: Параметры → Система → Питание, либо держи машину включённой |
| Логин невозможен, хотя сайт открылся: в `user` нет строк | установка упала между созданием организации и админа (например, битый `ADMIN_EMAIL`). Повторный старт её не доделает — `docker compose down -v`, поправь `.env`, подними заново |
| После смены `POSTGRES_PASSWORD` в `.env` — «password authentication failed» | Postgres запомнил пароль в томе при инициализации. Либо верни старый пароль, либо `docker compose down -v` (данные пропадут) |

## Ограничения стенда

Это OSS-сборка (без `ee/`), single tenancy:

- скрыты enterprise-фичи: SSO, платежи/магазин, SCORM, LTI, расширенная
  аналитика, live sessions;
- AI выключен (`LEARNHOUSE_IS_AI_ENABLED=False`) — включится только с ключом
  провайдера;
- почта не настроена: письма о сбросе пароля не уходят (см. Resend в
  `.env.example`);
- в all-in-one образе нет `ffmpeg`, поэтому видео не перепаковывается под
  faststart — воспроизведение работает, но старт потока может быть медленнее;
- данные живут в docker-томах на этой машине. Пропал диск/сделали `down -v` —
  пропал стенд.
