# ZeroKnowledge — installation

This repository is the ZeroKnowledge fork of LearnHouse. The bundled
`informatics` course is part of the application: it is created automatically on
the first API start in the default organization.

## Requirements

- Git
- Docker Desktop (PostgreSQL + Redis)
- Node.js 20+ and npm/npx
- Bun (used by the web app)
- Python 3.12+ (only for the manual API setup)
- A Judge0 instance or public Judge0 API URL for code tests

## Quick start

```bash
git clone -b "20/80" https://github.com/sandrakula/Zero_Knowledge.git
cd Zero_Knowledge
npx learnhouse@latest dev
```

The CLI starts PostgreSQL, Redis, the API, the web app and the collaboration
server. Open the URL printed by the command (usually `http://localhost:3000`).

Create the first account through the signup screen. It becomes the default
organization administrator.

## Manual development setup

### 1. Database and Redis

```bash
docker compose -f .learnhouse/docker-compose.dev.yml up -d
```

### 2. API

```bash
cd apps/api
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate

pip install -e .
```

Create `apps/api/.env` with at least:

```env
LEARNHOUSE_SQL_CONNECTION_STRING=postgresql+asyncpg://learnhouse:learnhouse@localhost:5432/learnhouse
LEARNHOUSE_REDIS_CONNECTION_STRING=redis://localhost:6379/0
LEARNHOUSE_JUDGE0_API_URL=https://your-judge0-instance.example.com
```

Then start the API:

```bash
python -m uvicorn app:app --host 127.0.0.1 --port 1338 --reload
```

On startup the API creates the default organization (if missing) and then seeds
the `informatics` course.

### 3. Web

```bash
cd apps/web
bun install
bun run dev
```

Open `http://localhost:3000`.

## Bundled informatics course

The course is seeded automatically from:

```text
apps/api/src/services/setup/informatics_seed.json
```

It contains:

- **Ввод-вывод, оператор присваивания, арифметические операции** — 22 tasks;
- **Условный оператор** — 31 task;
- Markdown statements and sample tests from informatics.msk.ru;
- C++ starter template for every code task.

The seeder is idempotent: if a course named `informatics` already exists in the
default organization, it is left untouched.

If the course is missing after startup:

1. Make sure the API started after the database was available.
2. Check the API log for `Seeded the bundled informatics course`.
3. Restart the API once; the seeder runs at startup.
4. If you use a non-default organization, create the organization first and
   restart the API — the seeder prefers the organization with slug `default`.

## Code execution

The informatics tasks are auto-graded by Judge0. Without a working Judge0 URL:

- code can still be edited;
- tests cannot be executed;
- submission is rejected with “Code checking is temporarily unavailable”.

Set `LEARNHOUSE_JUDGE0_API_URL` in `apps/api/.env` and restart the API.

## Updating

```bash
git pull origin "20/80"
```

Database migrations run on API startup. The seeder does not overwrite an
existing `informatics` course.
