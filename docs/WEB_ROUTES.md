# WEB_ROUTES — карта маршрутов LearnHouse Web

Документ описывает маршруты `apps/web` в том виде, в каком они существуют в исходниках на момент обзора. Это инвентаризация, а не предложение что-либо менять.

## 1. Как устроены URL

Web использует Next.js App Router и tenancy-прокси `apps/web/proxy.ts`.

- Публичный URL **не содержит** `/orgs/{slug}`. Прокси сам добавляет организационный префикс.
- Внутренний файловый маршрут выглядит как `app/orgs/[orgslug]/...`, а пользователь открывает `/courses`, `/dash`, `/board/...` и т. п.
- В текущем окружении `tenancy=single`, поэтому все запросы привязываются к организации `default` («ZeroKnowledge Academy»).
- Прямой запрос `/orgs/default/dash` снаружи даёт 404: прокси повторно добавляет префикс (`/orgs/default/orgs/default/dash`). Для ручного обзора используйте URL без `/orgs/{slug}`.
- Параметр `?chrome=none` отключает публичную шапку, подвал и watermark на страницах организации (используется для встраивания).
- `/embed/...`, `/board/...`, `/editor/...` и служебные `/api/...` обходятся прокси по отдельным правилам.
- **Глобальный auth-gate (Phase 2):** без cookie `LH_access`/`LH_refresh` любой путь, кроме `/login`, `/register`, `/auth/*` и health, редиректит на `/login`. `/signup` всегда редиректит на `/login`; регистрация доступна на `/register` и сразу активирует аккаунт с ролью студента.

Легенда доступа:

| Код | Значение |
|---|---|
| **P** | Публично; часть данных может требовать входа (например, приватный курс) |
| **A** | Требуется авторизованная сессия |
| **D** | Dashboard: нужен `dashboard.action_access` — Admin, Maintainer, Instructor |
| **ADM** | Дополнительно нужны права организации (обычно Admin; часть — Maintainer) |
| **EE** | Enterprise-only: в OSS недоступно или показывает заглушку |
| **SaaS** | Маршрут существует только в SaaS-режиме |

## 2. Корневые, auth- и служебные маршруты

| URL | Файл | Назначение | Действия | Ключевые компоненты/сервисы | Backend API | Доступ |
|---|---|---|---|---|---|---|
| `/` | `app/orgs/[orgslug]/(withmenu)/page.tsx` | Домашняя страница организации | Просмотр лендинга, курсов, сообществ; переходы в каталоги | `home-client.tsx`, `HomeClient`, SEO `generateMetadata` | `GET /orgs/slug/{slug}`, `/courses`, `/communities` | P |
| `/login` | `app/auth/login/page.tsx` + `login.tsx` | Вход для уже одобренных аккаунтов | E-mail + пароль; ссылка на регистрацию | `AuthLayout`, `useAuth`, `postAuthPathForSession` | `/api/auth/*`, `/users/session` | P |
| `/register` | `app/auth/register/page.tsx` + `register.tsx` | Свободная регистрация | Имя, e-mail, пароль; создание аккаунта и автовход | `AuthLayout`, `useAuth` | `/api/v1/auth/register` | P |
| `/signup` | `app/auth/signup/page.tsx` | Закрыт | Редирект на `/login` | `proxy.ts` | — | P → redirect |
| `/forgot` | `app/auth/forgot/page.tsx` | Запрос сброса пароля | Ввод email | `forgot.tsx`, `sendResetLink` | `/users/reset_password/platform/send_reset_code` | P |
| `/reset` | `app/auth/reset/page.tsx` | Смена пароля по коду | Новый пароль | `reset.tsx`, `resetPassword` | `/users/reset_password/platform/change_password` | P |
| `/verify-email` | `app/auth/verify-email/page.tsx` | Подтверждение email | Автовход после подтверждения | `verify-email.tsx` | `/api/auth/verify-email` | P |
| `/magic` | `app/auth/magic/page.tsx` | Переход по magic-link | Завершение входа, MFA | `AuthContext` | `/api/auth/magic-link/verify` | P |
| `/sso/callback` | `app/auth/sso/callback/page.tsx` | Callback SSO | Завершение SSO-входа | `services/auth/sso.ts` | `/auth/oauth`, SSO backend (EE) | EE |
| `/callback/google` | `app/auth/callback/google/page.tsx` | Callback Google OAuth | Завершение входа | `AuthContext`, `lib/auth/oauthBounce` | `/auth/oauth` | P |
| `/token-exchange` | `app/auth/token-exchange/page.tsx` | Обмен платформенного кода на сессию | Кросс-доменный вход | `app/api/auth/token-exchange/route.ts` | `/auth/refresh`, `/users/session` | P |
| `/home` | `app/home/page.tsx` | Выбор организации (SaaS) | Переход в организацию | `home.tsx` | `/orgs/user`, `/instance/info` | SaaS; в single tenancy редирект на `/` |
| `/admin` | `app/admin/(dashboard)/page.tsx` | Платформенная админка | Редирект на `/admin/organizations` | `admin/layout.tsx`, `lib/eeGate.ts` | `/admin/*` (EE/SaaS) | EE |
| `/admin/login` | `app/admin/login/page.tsx` | Вход суперадмина | Вход | `AdminProviders` | `/auth/login` | EE |
| `/admin/users` | `app/admin/(dashboard)/users/page.tsx` | Пользователи платформы | Просмотр/управление | `components/Admin/*` | `/admin/users...` | EE |
| `/admin/organizations` | `app/admin/(dashboard)/organizations/page.tsx` | Список организаций | Создание, фильтрация | `OrganizationList`, `CreateOrganizationModal` | `/admin/orgs...` | EE |
| `/admin/organizations/[orgId]` | `...[orgId]/page.tsx` | Карточка организации | Тариф, использование, участники, курсы | `Admin` components | `/admin/orgs/{id}...` | EE |
| `/admin/developers` | `app/admin/(dashboard)/developers/page.tsx` | Платформенные API-токены/playground | Управление токенами | `components/Admin/Developers/*` | `/admin/api_tokens` | EE |
| `/admin/analytics` | `app/admin/(dashboard)/analytics/page.tsx` | Платформенная аналитика | Дашборды | `components/Admin/*` | `/admin/analytics` | EE |
| `/oauth/consent` | `app/oauth/consent/page.tsx` | Согласие MCP-клиента | Выбор организации, разрешение | `services/mcp/mcp.ts` | `/api/v1/mcp/oauth/*` | P/A |
| `/oauth/approve` | `app/oauth/approve/page.tsx` | Подтверждение чувствительного действия MCP | Approve/deny | `services/mcp/mcp.ts` | `/api/v1/mcp/approvals` | A |
| `/board/[boarduuid]` | `app/board/[boarduuid]/page.tsx` | Полноэкранная доска | Рисование, presence, чат | `BoardCanvas`, `BoardYjsContext`, `HocuspocusProvider` | `/boards/{uuid}`, `/boards/{uuid}/membership`, WS `/collab` | P/A по настройкам доски |
| `/embed/[orgslug]/course/[courseuuid]/activity/[activityid]` | `app/embed/.../page.tsx` | Embed активности | Просмотр активности в iframe | `ActivityRenderer` | `/activities/...` | P |
| `/editor/course/[courseid]/activity/[activityuuid]/edit` | `app/editor/.../page.tsx` | Полноэкранный редактор активности | Редактирование контента | `Editor`, `EditorLoader` | `/activities/{uuid}`, `/activities/{uuid}/state` | DADM |
| `/course/[courseuuid]/activity/[activityuuid]/edit` | прокси → `/editor/...` | Внешний URL редактора | То же | `proxy.ts` | — | D |
| `/editor/playground/[playgrounduuid]/edit` | `app/editor/playground/.../page.tsx` | Редактор playground | Редактирование интерактивного элемента | `Playground` components | `/playgrounds/{uuid}` | D |
| `/payments/stripe/connect/oauth` | `app/payments/stripe/connect/oauth/page.tsx` | Stripe Connect OAuth | Подключение платежей | EE stub/реализация | `/api/billing/*` | EE |

### SaaS hub (в OSS недоступен)

Файлы в `app/(hub)/`; layout проверяет `instance/info` и вызывает `notFound()` при `mode=oss|ee`.

| URL | Файл | Назначение |
|---|---|---|
| `/organizations` | `(hub)/organizations/page.tsx` | Список организаций пользователя |
| `/new` | `(hub)/new/page.tsx` | Создание организации, выбор тарифа |
| `/billing` | `(hub)/billing/page.tsx` | Тариф, использование, счета, смена плана |
| `/subscriptions` | `(hub)/subscriptions/page.tsx` | Управление подписками |
| `/account` | `(hub)/account/page.tsx` | Платформенный аккаунт (в OSS `/account` перехватывается org-маршрутом) |

## 3. Публичный контур организации

Все маршруты ниже находятся в `app/orgs/[orgslug]/(withmenu)/`.

| URL | Назначение | Действия | Компоненты/сервисы | Backend API | Доступ |
|---|---|---|---|---|---|
| `/courses` | Каталог курсов | Поиск, фильтр по user group, пагинация, создание курса для админа | `courses.tsx`, `useCourses`, `CourseThumbnail`, `FeatureGate`, `CatalogPagination` | `GET /courses/org_slug/{slug}/page/...`, `/usergroups`, `/usergroups/{id}/resources` | P |
| `/course/[courseuuid]` | Страница курса | Дерево глав/активностей, прогресс, старт/продолжение, сертификат, обновления, авторы, сообщество | `course.tsx`, `CourseProvider`, `CourseProgress`, `CourseAuthors`, `CourseUpdates`, `DripGate` | `/courses/{uuid}`, `/courses/{uuid}/meta`, `/chapters`, `/activities`, `/trail`, `/certifications`, `/communities/course/{uuid}` | P (приватный — A) |
| `/course/[courseuuid]/activity/[activityid]` | Плеер активности | Просмотр контента, прогресс, завершение, скачивание, quiz/assignment/video/pdf | `activity.tsx`, `ActivityRenderer`, `AssignmentStudentActivity`, `Video`, `DocumentPdf`, `DynamicCanva` | `/activities/{uuid}`, `/activities/{uuid}/state`, `/blocks/...`, `/stream/...`, `/assignments/...`, `/code/...` | P/A |
| `/course/[courseuuid]/activity/end` | Финальный экран курса | Поздравление, сертификат, следующий шаг | `activity.tsx` | `/trail`, `/certifications` | P/A |
| `/paths` | Каталог learning paths | Просмотр, запись на path | `paths.tsx`, `usePaths` | `/paths/org/{slug}`, `/paths/my` | P |
| `/path/[pathuuid]` | Страница path | Состав курсов, прогресс, запись/выход, сертификат | `path.tsx`, `PathThumbnail` | `/paths/{uuid}`, `/paths/{uuid}/enroll`, `/paths/{uuid}/certificate` | P |
| `/paths/certificate/[uuid]` | Сертификат path | Просмотр/скачивание | `CertificateArtwork` | `/paths/certificates/{uuid}` | P |
| `/certificates/[uuid]/verify` | Проверка сертификата | Публичная верификация | `CertificateShowcase` | `/certifications/verify/{uuid}` | P |
| `/library` | Публичная библиотека | Поиск, папки, медиа, просмотр | `LibraryClient`, `library-cards` | `/folders`, `/folders/search`, `/media` | P |
| `/library/folder/[folderid]` | Содержимое папки | Навигация, просмотр ресурсов | `FolderClient` | `/folders/{uuid}`, `/folders/{uuid}/content` | P |
| `/podcasts` | Каталог подкастов | Просмотр, запуск плеера | `podcasts.tsx`, `PodcastPlayerProvider` | `/podcasts/org/{slug}` | P |
| `/podcast/[podcastuuid]` | Страница подкаста | Эпизоды, плеер, RSS | `podcast.tsx`, `EpisodeCard`, `PodcastSidebar` | `/podcasts/{uuid}`, `/podcasts/{uuid}/episodes` | P |
| `/communities` | Каталог сообществ | Поиск, переход | `communities.tsx`, `CommunityCard` | `/communities/org/{slug}` | P |
| `/community/[communityuuid]` | Сообщество | Обсуждения, фильтры, создание темы | `community.tsx`, `DiscussionList`, `SortDropdown`, `LabelFilter` | `/communities/{uuid}`, `/discussions/community/{uuid}` | P (закрытое — A) |
| `/community/[communityuuid]/discussion/[discussionuuid]` | Обсуждение | Комментарии, голоса, реакции, редактирование | `discussion.tsx`, `DiscussionDetail`, `CommentSection` | `/discussions/{uuid}`, `/discussions/{uuid}/comments`, `/discussions/{uuid}/votes` | P/A |
| `/boards` | Галерея досок | Список публичных/своих досок | `boards.tsx`, `useBoards` | `/boards/org/{slug}` | P/A |
| `/playgrounds` | Каталог playgrounds | Просмотр, реакции | `playgrounds.tsx`, `usePlaygrounds` | `/playgrounds/org/{slug}` | P |
| `/playground/[playgrounduuid]` | Playground | Интерактивный контент, реакции | `view.tsx`, `Playground` components | `/playgrounds/{uuid}`, `/playgrounds/{uuid}/reactions` | P |
| `/live` | Каталог live-сессий | Просмотр расписания | `LiveCatalogPage` (`@ee`) | `/ee/...` / live backend | EE |
| `/live/[sessionuuid]` | Live-сессия | Регистрация/вход | `LiveSessionPage` (`@ee`) | EE | EE |
| `/live/[sessionuuid]/room` | Комната трансляции | Live room | `LiveRoomPage` (`@ee`) | EE/LiveKit | EE |
| `/store` | Магазин организации | Каталог офферов | `StorePage` (`@ee`) | Payments backend | EE |
| `/store/offers/[offerid]` | Оффер | Покупка/бесплатный доступ | `OfferPage` (`@ee`) | Payments backend | EE |
| `/messages` | Сообщения | DM, группы, broadcast, агенты, напоминания | `messages.tsx`, `MessagingProvider`, `ChatDock` | `/messaging/*` (в OSS messaging отключён) | A/EE |
| `/calendar` | Календарь | Дедлайны, drip, live-события | `calendar.tsx` | `/calendar` | A |
| `/trail` | Лента обучения | История активности и прогресса | `trail.tsx`, `useTrail` | `/trail` | A |
| `/copilot` | AI-помощник | Чат по контенту организации | `copilot` components, `services/ai` | `/ai/*` (AI выключен) | A |
| `/search` | Поиск по организации | Курсы, активности, сообщества, пользователи | `search/page.tsx`, `searchOrgContent` | `/search?org_id=...` | P |
| `/user/[username]` | Публичный профиль | Профиль, курсы/активность | `UserProfileClient` | `/users/username/{username}`, `/users/{id}/courses` | P |
| `/account` | Аккаунт в организации | General/Profile/Security/Purchases/AI apps | `AccountClient`, `AccountSidebar` | `/users`, `/users/session`, `/orgs`, `/mcp` | A |
| `/cabinet` | Лёгкий кабинет студента | Мои курсы и прогресс, дедлайны, ссылки на аккаунт | `cabinet/page.tsx` | `/trail`, `/calendar` | A (student) |
| `/account/[subpage]` | Подстраницы аккаунта | `general`, `profile`, `security`, `purchases`, `ai-apps` | `AccountGeneral`, `AccountProfile`, `AccountSecurity`, `AccountPurchases` (`@ee`), MCP apps | `/users/{id}`, `/auth/mfa`, `/mcp` | A |

## 4. Dashboard организации

Все маршруты ниже находятся в `app/orgs/[orgslug]/dash/`. Общий layout: `ClientAdminLayout` → `AdminAuthorization` (страницы `/dash*`), `SessionGate`, `CommandPalette`, `AtlasMiniProvider`.

| URL | Назначение | Действия | Компоненты/сервисы | Backend API | Доступ |
|---|---|---|---|---|---|
| `/dash` | Главная дашборда | Обзор, план, usage, недавние курсы/участники, onboarding | `DashboardHome`, `RecentCourses`, `RecentMembers`, `ContentOverview`, `UsageOverview` | `/orgs/{id}/usage`, `/courses/...`, `/orgs/{id}/users` | D |
| `/dash/courses` | Управление курсами | Создать (scratch/AI/import), искать, клонировать, удалить, экспортировать, thumbnail | `client.tsx`, `CreateCourseModal`, `CourseCreationTypeSelector`, `LearnHouseCourseImport`, `LmsCourseImport`, `ScormCourseImport` (`@ee`) | `/courses/...`, `/courses/{uuid}/clone`, `/courses/{uuid}/thumbnail`, `/courses/export` | DADM |
| `/dash/courses/migrate` | AI-миграция контента | Загрузка файлов, анализ структуры, генерация дерева | `client.tsx`, `MigrationWizard/*` | `/courses/migrate/upload`, `/courses/migrate/analyze`, `/courses/migrate/structure` | DADM + AI |
| `/dash/courses/course/[courseuuid]/general` | Настройки курса | Название, описание, public/published, обложка | `EditCourseGeneral` | `PUT /courses/{uuid}` | DADM |
| `/dash/courses/course/[courseuuid]/content` | Структура курса | Главы, активности, порядок, lock/drip | `EditCourseStructure`, `ChapterElement`, `ActivityElement`, `LockPopover` | `/chapters`, `/activities`, `/activities/reorder` | DADM |
| `/dash/courses/course/[courseuuid]/schedule` | Drip-расписание | Правила открытия глав | `EditCourseSchedule` | `/courses/{uuid}/drip` | D |
| `/dash/courses/course/[courseuuid]/access` | Доступ | User groups, приватность | `EditCourseAccess`, `LinkToUserGroup` | `/usergroups`, `/usergroups/{id}/resources` | DADM |
| `/dash/courses/course/[courseuuid]/contributors` | Соавторы | Приглашение, роли, удаление | `EditCourseContributors` | `/courses/{uuid}/contributors` | D |
| `/dash/courses/course/[courseuuid]/seo` | SEO курса | Meta, OG, robots | `EditCourseSEO` | `PUT /courses/{uuid}` (seo) | D |
| `/dash/courses/course/[courseuuid]/certification` | Сертификат курса | Дизайн и правила выдачи | `EditCourseCertification`, `CertificateDesigner` | `/certifications` | D |
| `/dash/courses/course/[courseuuid]/analytics` | Аналитика курса | Метрики | `CourseAnalyticsTab` (`@ee`) | EE | EE |
| `/dash/assignments` | Задания | Список, поиск, создание, публикация, переходы | `page.tsx`, `NewAssignmentModal`, `assignmentUi` | `/assignments` | D |
| `/dash/assignments/[assignmentuuid]` | Задание | Редактор, задачи, решения, проверка, аналитика | `page.tsx`, `TaskEditor`, `Tasks`, `EvaluateAssignment`, `AssignmentSubmissionsSubPage`, `AssignmentAnalyticsSubPage` | `/assignments/{uuid}`, `/assignments/{uuid}/tasks`, `/assignments/{uuid}/submissions`, `/assignments/grade` | D |
| `/dash/library` | Библиотека | Папки, медиа, загрузка, сортировка | `client.tsx`, `FolderThumbnail`, `MediaThumbnail` | `/folders`, `/folders/root`, `/media` | D |
| `/dash/library/folder/[folderid]` | Папка | Содержимое, перемещение, сортировка | `FolderClient` | `/folders/{uuid}`, `/folders/{uuid}/content` | D |
| `/dash/paths` | Learning paths | Список, создание | `client.tsx`, `CreatePathModal` | `/paths` | D |
| `/dash/paths/path/[pathuuid]/general` | Настройки path | Название, описание, обложка | `EditPathGeneral` | `/paths/{uuid}` | D |
| `/dash/paths/path/[pathuuid]/courses` | Состав path | Добавление/порядок курсов | `EditPathCourses` | `/paths/{uuid}` | D |
| `/dash/paths/path/[pathuuid]/certificate` | Сертификат path | Правила выдачи | `EditPathCertificate` | `/paths/{uuid}` | D |
| `/dash/paths/path/[pathuuid]/learners` | Учащиеся path | Прогресс, сертификаты | `PathLearners` | `/paths/{uuid}/learners` | D |
| `/dash/communities` | Сообщества | Список, создание | `client.tsx`, `CreateCommunityModal` | `/communities` | D |
| `/dash/communities/[communityuuid]` | Обзор сообщества | Метрики и обсуждения | `page.tsx` | `/communities/{uuid}`, `/discussions` | D |
| `/dash/communities/[communityuuid]/general` | Настройки | Название, описание | `CommunityEditGeneral` | `PUT /communities/{uuid}` | D |
| `/dash/communities/[communityuuid]/thumbnail` | Обложка | Загрузка | `CommunityEditThumbnail` | `/communities/{uuid}/thumbnail` | D |
| `/dash/communities/[communityuuid]/access` | Доступ | User groups | `CommunityEditAccess` | `/usergroups` | DADM |
| `/dash/communities/[communityuuid]/course` | Связь с курсом | Привязать/отвязать курс | `CommunityEditCourse`, `LinkCourseModal` | `/communities/{uuid}/course` | D |
| `/dash/communities/[communityuuid]/moderation` | Модерация | Стоп-слова, настройки | `CommunityEditModeration`, `ModerationSettingsModal` | `/communities/{uuid}/moderation` | D |
| `/dash/boards` | Доски | Список, создание, дублирование, удаление | `client.tsx` | `/boards` | D |
| `/dash/boards/[boarduuid]` | Доска | Открыть canvas, участники | `page.tsx`, `BoardCanvas` | `/boards/{uuid}` | D |
| `/dash/boards/[boarduuid]/general` | Настройки доски | Имя, public | `BoardGeneralTab` | `/boards/{uuid}` | D |
| `/dash/boards/[boarduuid]/thumbnail` | Обложка | Загрузка | `BoardThumbnailTab` | `/boards/{uuid}/thumbnail` | D |
| `/dash/boards/[boarduuid]/access` | Доступ | Публичность | `BoardAccessTab` | `/boards/{uuid}` | D |
| `/dash/boards/[boarduuid]/members` | Участники | Добавление/роли | `BoardMembersTab` | `/boards/{uuid}/members` | D |
| `/dash/podcasts` | Подкасты | Список, создание | `client.tsx`, `CreatePodcastModal` | `/podcasts` | D |
| `/dash/podcasts/podcast/[podcastuuid]/general` | Настройки | Имя, описание | `EditPodcastGeneral` | `/podcasts/{uuid}` | D |
| `/dash/podcasts/podcast/[podcastuuid]/content` | Эпизоды | Добавление, аудио, порядок | `EditPodcastEpisodes` | `/podcasts/{uuid}/episodes`, `/episodes` | D |
| `/dash/podcasts/podcast/[podcastuuid]/distribution` | RSS/распространение | Настройки фида | `PodcastDistribution` | `/podcasts/{uuid}` | D |
| `/dash/playgrounds` | Playgrounds | Список, создание | `client.tsx` | `/playgrounds` | D |
| `/dash/live-sessions` | Live-сессии | Дашборд | `LiveSessionsDashPage` (`@ee`) | EE | EE |
| `/dash/live-sessions/settings` | Настройки live | Live-провайдер | `LiveSessionSettingsPage` (`@ee`) | EE | EE |
| `/dash/live-sessions/session/[sessionuuid]/[subpage]` | Управление сессией | Детали/участники | `LiveSessionManagePage` (`@ee`) | EE | EE |
| `/dash/payments/[subpage]` | Платежи | Офферы, подписки | `@ee` stub | EE | EE |
| `/dash/analytics` | Org analytics | Дашборды | `@ee` stub | EE | EE |
| `/dash/atlas` | Atlas | AI-дашборд | `AtlasPage` (`@ee`) | EE | EE |
| `/dash/users/analytics/[userId]` | Аналитика пользователя | Аудит обучения | `UserAnalyticsPage` (`@ee`) | EE | EE |
| `/dash/users/settings/users` | Пользователи | Список, поиск, роли, удаление, приглашения | `OrgUsers` | `/orgs/{id}/users`, `/orgs/{id}/users/{uid}/role/{role}` | ADM |
| `/dash/users/settings/signups` | Регистрация | Режим join, поля signup | `OrgAccess`, `OrgSignupFields` | `/orgs/{id}/signup`, `/orgs/{id}/signup-fields` | ADM |
| `/dash/users/settings/add` | Добавить пользователя | Создание/инвайт | `OrgUsersAdd` | `/users/{org}`, `/orgs/{id}/invites` | ADM |
| `/dash/users/settings/usergroups` | User groups | Группы, участники, ресурсы | `OrgUserGroups`, `ManageUsers`, `AddUserGroup` | `/usergroups`, `/usergroups/{id}/users`, `/usergroups/{id}/resources` | ADM |
| `/dash/users/settings/roles` | Роли | CRUD ролей и прав | `OrgRoles`, `AddRole`, `EditRole` | `/roles` | ADM |
| `/dash/users/settings/audit-logs` | Аудит | Журнал действий | `OrgAuditLogs` | EE | EE |
| `/dash/users/settings/two-factor` | 2FA-политика | Требование MFA | `OrgTwoFactorPolicy` | `/auth/mfa/org-policy` | ADM |
| `/dash/users/settings/sign-in` | Способы входа | Пароль/magic/Google/SSO | `OrgSignInMethods` | `/orgs/{id}/auth-methods` | ADM |
| `/dash/org/settings/general` | Организация | Название, slug, описание, контакты | `OrgEditGeneral` | `PUT /orgs/{id}` | ADM |
| `/dash/org/settings/features` | Feature toggles | Включение boards/communities/paths/... | `OrgEditFeatures` | `/orgs/{id}/features/{feature}` | ADM |
| `/dash/org/settings/branding` | Брендинг | Цвета, шрифты, логотипы, auth-фон | `OrgEditBranding`, `BrandingVignettes` | `/orgs/{id}/logo`, `/favicon`, `/auth-background`, `/colors` | ADM |
| `/dash/org/settings/menu` | Публичное меню | Порядок и состав ссылок | `OrgEditMenu` | `/orgs/{id}/menu` | ADM |
| `/dash/org/settings/landing` | Лендинг | Секции и блоки | `OrgEditLanding`, `LandingBlockEditors` | `/orgs/{id}/landing` | ADM |
| `/dash/org/settings/course-end` | Финальный экран курса | Поздравление, действия | `OrgEditCourseEnd` | `/orgs/{id}/course-end` | ADM |
| `/dash/org/settings/ai` | AI-настройки | Модели и лимиты | `OrgEditAI` | `/orgs/{id}/ai` | ADM |
| `/dash/org/settings/analytics` | Analytics-настройки | Параметры трекинга | `OrgEditAnalytics` (`@ee`) | EE | EE |
| `/dash/org/settings/usage` | Usage | Лимиты и потребление | `OrgEditUsage` | `/orgs/{id}/usage` | ADM |
| `/dash/org/settings/other` | Прочее | Дополнительные параметры | `OrgEditOther` | `/orgs/{id}` | ADM |
| `/dash/org/settings/danger` | Danger zone | Удаление/очистка | `OrgEditDangerZone` | `DELETE /orgs/{id}`, `/orgs/{id}/wipe` | ADM |
| `/dash/developers/api` | API Access | API-токены, права, OpenAPI | `OrgEditAPIAccess`, `APIDocumentation` | `/orgs/{id}/api-tokens`, `/openapi.json` | ADM (pro) |
| `/dash/developers/automations` | Automations | Webhooks и события | `OrgEditAutomations` | `/orgs/{id}/webhooks` | ADM |
| `/dash/developers/domains` | Custom domains | DNS, проверка, SSL | `OrgEditDomains` | `/orgs/custom-domains` | ADM |
| `/dash/developers/seo` | SEO организации | Meta, sitemap, OG | `OrgEditSEO` | `/orgs/{id}/seo` | ADM |
| `/dash/developers/mcp` | MCP | Подключение внешних AI-приложений | `OrgEditMCP` | `/mcp`, `/mcp/oauth` | ADM |
| `/dash/developers/sso` | SSO | OAuth/WorkOS | `OrgEditSSO` | EE | EE |
| `/dash/developers/lti` | LTI | LMS-интеграция | `OrgEditLTI` (`@ee`) | EE | EE |
| `/dash/onboarding` | Launch plan | Чек-лист запуска, обучение | `LaunchPlan`, `OnboardingVideo`, `useOnboarding` | локальное состояние + API настроек | D |

### Устаревшие/перемещённые URL dashboard

`/dash/org/settings/{developers,api,automations,domains,seo,sso}` редиректят на `/dash/developers/{...}`. `/dash/org/settings/security` редиректит на `/dash/users/settings/two-factor` (см. `page.tsx`).

## 5. Next.js Route Handlers (same-origin BFF)

| URL | Файл | Назначение |
|---|---|---|
| `/api/v1/[...path]` | `app/api/v1/[...path]/route.ts` | Потоковый прокси к FastAPI (включая SSE, range-запросы, большие uploads) |
| `/api/auth/[...path]` | `app/api/auth/[...path]/route.ts` | Auth-прокси: login/refresh/logout/MFA/magic link; cookie `LH_access`/`LH_refresh` |
| `/api/auth/token-exchange` | `app/api/auth/token-exchange/route.ts` | Обмен платформенного кода на локальную сессию |
| `/api/auth/google/{authorize,token,state}` | `app/api/auth/google/*` | Google OAuth |
| `/api/auth/lti/{...}` | `app/api/auth/lti/*` | LTI launch/link/check (EE stub) |
| `/api/signup` | `app/api/signup/route.ts` | Turnstile, disposable email, создание пользователя, Loops |
| `/api/turnstile/verify` | `app/api/turnstile/verify/route.ts` | Проверка Turnstile (SaaS) |
| `/api/billing/{checkout,portal,subscription,switch,cancel,invoices,prices,promo,upcoming,pack-checkout,fulfill,delete-org,cron/reconcile,webhook}` | `app/api/billing/*` | SaaS billing (Stripe), в OSS не функционирует |
| `/api/loops/admin` | `app/api/loops/admin/route.ts` | Синхронизация маркетинговых контактов |
| `/api/sitemap`, `/api/robots` | `app/api/*/route.ts` | SEO по организации |
| `/api/podcast/[uuid]/feed`, `/api/course/[uuid]/updates/feed` | feeds | RSS |
| `/api/revalidate` | `app/api/revalidate/route.ts` | Ревалидация Next-кэша |
| `/api/health` | `app/api/health/route.ts` | Health web-слоя |
| `/api/scorm/[...path]` | `app/api/scorm/...` | SCORM content (EE stub) |

## 6. Backend API по доменам

Все пути ниже имеют префикс `/api/v1` (кроме `/mcp` и discovery).

| Домен | Основные группы endpoints |
|---|---|
| Auth/Users | `/auth/{login,refresh,logout,oauth,magic-link,verify-email,login/mfa}`, `/auth/register`, `/users/session`, `/users/profile`, `/users/{id}`, `/users/reset_password/*` |
| MFA | `/auth/mfa/{setup,confirm,disable,backup-codes,...}`, `/auth/mfa/org-policy`, `/auth/mfa/compliance` |
| Organizations | `/orgs`, `/orgs/slug/{slug}`, `/orgs/{id}/users`, `/orgs/{id}/usage`, `/orgs/{id}/signup-fields`, `/orgs/{id}/invites`, `/orgs/{id}/logo|favicon|thumbnail|auth-background`, `/orgs/custom-domains` |
| Roles/User groups | `/roles`, `/usergroups`, `/usergroups/{id}/users`, `/usergroups/{id}/resources` |
| Courses | `/courses`, `/courses/{uuid}`, `/courses/{uuid}/meta`, `/courses/org_slug/{slug}`, `/courses/{uuid}/clone`, `/courses/{uuid}/contributors`, `/courses/{uuid}/drip`, `/courses/{uuid}/updates`, `/courses/export`, `/courses/import` |
| Chapters/Activities/Blocks | `/chapters`, `/activities`, `/activities/{uuid}/versions`, `/activities/{uuid}/state`, `/blocks` |
| Assignments | `/assignments`, `/assignments/{uuid}`, `/assignments/{uuid}/tasks`, `/assignments/{uuid}/submissions`, `/assignments/{uuid}/submission/me`, `/assignments/grade`, `/assignments/retry` |
| Paths | `/paths`, `/paths/{uuid}`, `/paths/{uuid}/enroll`, `/paths/{uuid}/learners`, `/paths/certificates/{uuid}` |
| Certifications | `/certifications`, `/certifications/{uuid}`, `/certifications/verify/{uuid}` |
| Communities | `/communities`, `/communities/{uuid}`, `/communities/{uuid}/course`, `/communities/{uuid}/moderation`, `/discussions`, `/discussions/{uuid}/comments`, `/discussions/{uuid}/votes`, `/discussions/{uuid}/reactions` |
| Boards | `/boards`, `/boards/{uuid}`, `/boards/{uuid}/members`, `/boards/{uuid}/membership`, внутренние `/boards/{uuid}/ydoc` |
| Library/Media | `/folders`, `/folders/root`, `/folders/search`, `/folders/{uuid}/content`, `/media`, `/media/{uuid}/file`, `/media/shared/{token}/file` |
| Podcasts | `/podcasts`, `/podcasts/{uuid}`, `/podcasts/{uuid}/episodes`, `/episodes/{uuid}`, `/podcasts/{uuid}/feed` |
| Playgrounds | `/playgrounds`, `/playgrounds/{uuid}`, `/playgrounds/{uuid}/reactions`, `/playgrounds/generate/*` |
| Live sessions | `/ee/live-sessions/*` (EE) |
| AI | `/ai/chat`, `/ai/editor`, `/ai/quiz`, `/ai/assignment`, `/ai/scenario`, `/ai/images`, `/ai/audio`, `/ai/courseplanning`, `/ai/magicblocks`, `/ai/rag/*`, `/orgs/{id}/ai-credits` |
| MCP | `/mcp` (root), `.well-known/oauth-*`, `/oauth/{register,authorize,token,revoke}`, `/api/v1/mcp/{consent,approvals,apps}` |
| Search | `/search` |
| Calendar | `/calendar` |
| Trail | `/trail` |
| Messaging | `/messaging/{conversations,messages,agents,reminders,unread,directory,presence,broadcast}` (OSS: домен отключён) |
| Code execution | `/code/execute`, `/code/execute/batch`, `/code/upload-sqlite`, `/code/submissions` |
| Analytics | `/ee/analytics/*` (EE) |
| Billing/Plans | `/plans`, `/orgs/{id}/packs`, `/cloud_internal/*` (SaaS) |
| Webhooks/Zapier | `/orgs/{id}/webhooks`, `/integrations/zapier/*` |
| API tokens | `/orgs/{id}/api-tokens` |
| Admin | `/admin/*` (EE/SaaS) |
| Streaming | `/stream/{uuid}`, `/stream/hls/...`, `/stream/block-hls/...`, captions |
| Email preferences | `/emails/unsubscribe`, `/internal/emails/*` |
| Demo/Dev/Health | `/demo/*`, `/dev/*`, `/health`, `/instance/info` |

## 7. Матрица «роль → доступные зоны»

| Зона | Аноним | User (студент) | Instructor (преподаватель) | Maintainer (роль удалена) | Admin |
|---|---|---|---|---|---|
| Публичные каталоги и опубликованный контент | да | да | да | да | да |
| Приватный/ограниченный контент | нет | по membership/usergroup | да | да | да |
| `/account`, `/calendar`, `/trail` | нет | да | да | да | да |
| `/dash` | нет | **нет** (`dashboard.access=false`) | да | да | да |
| Создание/редактирование собственных курсов и активностей | нет | нет | да | да | да |
| Задания: автор/проверка | нет | нет | да (assignments create/read/update) | да | да |
| Communities: создание/модерация | нет | нет (только обсуждения) | нет (read) | да | да |
| Boards: создание | нет | нет | да (own) | да | да |
| User groups | нет | read | read | да | да |
| Пользователи организации | нет | нет | нет | create/read/update (без delete) | да |
| Роли | нет | нет | нет | read | да |
| Настройки организации | нет | нет | нет | read | да |
| Developers/API tokens/webhooks/domains | нет | нет | нет | да | да |
| Platform admin `/admin` | нет | нет | нет | нет | EE/SaaS + superadmin |
| Org analytics / payments / live / SSO / LTI / audit | нет | нет | нет | нет | EE |

Источники прав: `apps/api/src/services/setup/setup.py` (роли `Admin`, `Maintainer`, `Instructor`, `User`), `apps/web/components/Security/AdminAuthorization.tsx`, `apps/web/lib/dashboard-menu-items.ts`.

## 8. Маршруты, недоступные или ограниченные в текущем окружении

| Маршрут/зона | Причина |
|---|---|
| `/admin*` | OSS: `EERequiredScreen` в `app/admin/layout.tsx` |
| `/home`, `/organizations`, `/billing`, `/subscriptions`, `/new`, hub `/account` | SaaS-only layout `app/(hub)/layout.tsx` вызывает `notFound()` при `mode=oss|ee` |
| `/dash/analytics`, `/dash/users/analytics/*`, `/dash/org/settings/analytics`, course `analytics` tab | EE-only, скрыты `isOrgAnalyticsAvailable()`; stub `@ee` |
| `/dash/payments/*`, `/store*`, `/payments/stripe/connect/oauth` | Payments — EE; stub вызывает `notFound()` |
| `/dash/live-sessions*`, `/live*` | Live sessions — EE-only |
| `/dash/atlas` | `@ee/components/Atlas/AtlasPage` |
| `/dash/developers/{sso,lti}`, `/lti/*` | EE-only, скрыты `isFeatureAvailable` |
| `/messages`, messaging dock/agents | Backend `messaging` входит в `EE_ONLY_FEATURES` (`deployment_mode.py`) |
| `/copilot`, AI-генераторы, `/dash/courses/migrate` | AI выключен в текущем окружении (`LEARNHOUSE_IS_AI_ENABLED=false`) |
| SCORM-импорт и SCORM-активности | EE-only; frontend stub, backend `/api/v1/scorm` отсутствует |
| Email-инвайты, verification, magic link, reset | Требуется настроенный Resend/SMTP; в текущем окружении не настроен |
| Turnstile, Loops, PostHog, Sentry | Ключи не заданы; интеграции молча отключены |
| Выполнение кода (Judge0) | Judge0 не запущен |
| HLS/видео-транскодирование | Отключено по умолчанию; локально нет ffmpeg-пайплайна |

## 9. Замечания по маршрутизации

1. **Организационный slug не является частью публичного URL.** Это главная ловушка при ручном обзоре: `/orgs/default/...` даёт 404.
2. **Первый заход на `/login`** до установки cookie `LH_org` может отрисовать экран «Укажите вашу организацию» (`OrgNotFound`), если серверный fetch организации не удался. После успешного fetch и установки cookie показывается форма входа.
3. **Server-side `localhost` на Windows.** Если API слушает IPv4, а Node резолвит `localhost` в `::1`, серверные компоненты получают 404/ошибку. В этом окружении используется `LEARNHOUSE_INTERNAL_API_URL=http://127.0.0.1:1338`.
4. **Динамические `[subpage]`** не валидируются жёстко на уровне Next: неизвестная подстраница рендерит пустой контент либо редиректит (например, `/account/*`).
5. **`?new=true`** на `/courses` и `/dash/courses` автоматически открывает модалку создания курса.
6. **`?chrome=none`** убирает публичную обвязку — используется в iframe/embed-сценариях.
7. **Legacy-редиректы** для `/dashboard/*` в multi tenancy описаны в `proxy.ts`; в single tenancy они не применяются.
