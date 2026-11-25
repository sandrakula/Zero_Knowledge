# WEB_COMPONENT_MAP — компоненты, контексты и зависимости Web

Карта построена по `apps/web` на момент обзора. Она фиксирует фактическую структуру, не предлагая упрощений.

## 1. Дерево приложения и оболочки

```
app/
  layout.tsx                  корневой html/body, шрифты, Providers, Sentry
  error.tsx / global-error.tsx / not-found.tsx
  providers.tsx? (см. components/Providers.tsx)
  auth/                       login, signup, forgot, reset, verify-email, magic, sso, callback
  (hub)/                      SaaS: организации, billing, subscriptions, account
  admin/                      платформенная админка (EE/SaaS)
  orgs/[orgslug]/
    layout.tsx                OrgProvider + OrgLanguageSync
    (withmenu)/               публичный контур: courses, communities, library, paths, ...
    dash/                     административный контур организации
    lti/                      LTI (EE)
  embed/                      iframe-активности
  board/                      полноэкранная доска
  editor/                     полноэкранные редакторы
  oauth/                      MCP consent/approve
  payments/                   Stripe Connect (EE)
  api/                        Next Route Handlers (BFF)
```

Провайдеры верхнего уровня: `components/Providers.tsx` (i18n, session, org, query client, toasts и др.). Точный состав см. в файле; он подключается корневым `app/layout.tsx`.

### Layout-оболочки

| Файл | Что делает |
|---|---|
| `app/orgs/[orgslug]/layout.tsx` | `OrgProvider`, `OrgLanguageSync` |
| `app/orgs/[orgslug]/(withmenu)/layout.tsx` | `SessionGate`, `OrgJoinBanner`, `OrgMenu`, `OrgMFAPolicyGate`, `PodcastPlayerProvider`, `SiteCommandPalette`, `Shortcuts`, `MessagingProvider`, `ChatDock`, `LiveNowBanner`, watermark/footer |
| `app/orgs/[orgslug]/dash/layout.tsx` → `ClientAdminLayout.tsx` | `SessionGate`, `AdminAuthorization`, `CommandPalette`, `UpgradeModalProvider`, `AtlasMiniProvider`, `DashLeftMenu`/`DashMobileMenu`, `OnboardingTracker`, `WelcomeModal` |
| `app/admin/layout.tsx` | Проверка deployment mode; в OSS — `EERequiredScreen` |
| `app/(hub)/layout.tsx` | SaaS-only гейт через `/instance/info` |
| `app/auth/layout.tsx` | `OrgProvider` при наличии org, иначе org-less auth |

## 2. Контексты и глобальное состояние

| Контекст | Файл | Роль | Потребители |
|---|---|---|---|
| Auth | `components/Contexts/AuthContext.tsx` | `SessionProvider`, `useSession`, `signIn`, `signOut`, MFA, magic link, OAuth state; кэш сессии | Все auth-страницы, header, guards |
| LH Session | `components/Contexts/LHSessionContext.tsx` | `SessionGate`, `useLHSession`; статус и токены | Layouts, почти все интерактивные страницы |
| Org | `components/Contexts/OrgContext.tsx` | Текущая организация, config, features, членство | Меню, страницы, feature gates |
| Course | `components/Contexts/CourseContext.tsx` | Текущий курс и дерево | Плеер, редактор курса |
| Community | `components/Contexts/CommunityContext.tsx` | Текущее сообщество | Community pages/dashboard |
| Podcast | `components/Contexts/PodcastContext.tsx` | Текущий подкаст | Podcast dashboard |
| Podcast Player | `components/Contexts/PodcastPlayerContext.tsx` | Глобальный плеер, очередь | `(withmenu)` layout, podcast pages |
| Messaging | `components/Messaging/MessagingProvider.tsx` | Диалоги, unread, presence, dock | Org layout, `/messages` |
| AI | `components/Contexts/AI/*` | Состояние AI-панелей | Editor, copilot, generators |
| Assignments | `components/Contexts/Assignments/*` | Состояние задания/сабмита | Assignment UI |
| Editor | `components/Contexts/Editor/*` | Состояние редактора | Editor, activity editor |
| Background tasks | `components/Contexts/BackgroundTasksContext.tsx` | Длительные операции, прогресс | Экспорт/импорт, uploads |
| i18n | `components/Contexts/I18nContext.tsx`, `lib/i18n.ts` | Язык, переводы | Весь UI |
| Direction | `components/Contexts/DirectionProvider.tsx` | RTL/LTR | Весь UI |
| PostHog | `components/Contexts/PostHogProvider.tsx` | Клиентская телеметрия (опционально) | Страницы/события |
| Org language sync | `components/Contexts/OrgLanguageSync.tsx` | Применяет язык организации | Org layout |
| Auth fetch interceptor | `components/Contexts/AuthFetchInterceptor.tsx` | 401 → refresh/expired | API-запросы |

## 3. Переиспользуемые компоненты по областям

Каталог сгруппирован; в каждой группе перечислены ключевые файлы, а не все листовые компоненты.

### 3.1 Курсы и обучение

`components/Objects/Courses/`:
- `CourseThumbnail`, `CourseThumbnailLanding`, `CourseActions/CoursesActions`, `CourseAuthors`, `CourseProgress`, `CourseShare`, `CourseUpdates`, `CoursePaths`, `CourseAccessError`, `DripGate`, `DripBadge`.
- Модалки: `Objects/Modals/Course/Create/CreateCourse`, `CourseCreationTypeSelector`, `AICourse/AICourseCreationModal`, `Import/{ImportTypeSelector,LearnHouseCourseImport,LmsCourseImport}`, `MigrationWizard/*`.

### 3.2 Редактор

`components/Objects/Editor/`:
- `Editor`, `EditorWrapper`, `EditorLoader`, `EditorPreview`, `EditorSkeleton`, `ActivitySwitcher`, `FileUploadBlock`.
- `Toolbar/*`, `VersionHistory/{VersionHistoryPanel,MergeConflictModal}`, `Templates/TemplatesModal`, `AI/{AIEditorToolkit,AIEditorSidePanel}`.
- Расширения: Image, Video, Audio, PDF, Quiz, Scenarios, Flipcard, Callout, Badges, Buttons, EmbedObjects, H5P, MathEquation, CodePlayground, MagicBlocks, Dynamic (variables/rules/reach), Library, Users, SlashCommands, DragHandle, WebPreview.

### 3.3 Активности и плеер

`components/Objects/Activities/`:
- `ActivityRenderer`, `ActivityPreview`, `StaticCanva`, `DynamicCanva` (+ `TableOfContents`, AI toolkit).
- Video: `Video`, `LearnHousePlayer`, `VideoChapters`, `ChaptersSettings`, `CaptionsSettings`, `videoSource`.
- Document: `DocumentPdf`, `PdfMobileReader`.
- Assignment: `AssignmentStudentActivity`, `AssignmentBoxUI`.
- Embed/Markdown/Resource: `EmbedActivity`, `MarkdownActivity`, `ResourceActivity`.
- AI: `AIActivityAsk`, `AIMarkdownRenderer`, `AIFollowUpSuggestions`.

### 3.4 Сообщества

`components/Objects/Communities/`:
- `CommunityCard`, `CommunityHeader`, `CommunitySidebar`, `CommunityActions`, `CommunityActionsMobile`, `CourseCommunitySection`.
- `DiscussionList`, `DiscussionCard`, `DiscussionDetail`, `DiscussionContent`, `DiscussionEditor`, `DiscussionSidebar`, `CommentSection`, `CommentCard`, `UpvoteButton`, `CommentUpvoteButton`, `ReactionButton`, `LabelFilter`, `SortDropdown`, `EmojiPicker`, `Tags/*`.
- Модалки: `Modals/Communities/{CreateCommunityModal,EditCommunityModal,CommunityThumbnailModal,ModerationSettingsModal,LinkCourseModal,CreateDiscussionModal,EditDiscussionModal}`.

### 3.5 Доски

`components/Dashboard/Boards/`:
- `BoardCanvas`, `BoardEffects`, `BoardSelectionContext`, `BoardToolbar`, `BoardTopBar`, `BoardTopRight`, `BoardYjsContext`, `BoardZoomControls`, `EphemeralChat`, `PresenceAvatars`, `RemoteCursors`, `Extensions/*`, `Tabs/*`.
- Провайдер `@hocuspocus/provider`; WebSocket URL из `getCollabUrl()`.

### 3.6 Меню, поиск, shortcuts

- `Objects/Menus/{OrgMenu,OrgMenuLinks,MobileNav,menuIcons}`.
- `Dashboard/Menus/{DashLeftMenu,DashMobileMenu}`; источник — `lib/dashboard-menu-items.ts`.
- `Objects/Search/{SiteCommandPalette,SiteCommandPaletteContext,SearchTrigger}`; реестр — `lib/site-search/registry.ts`.
- `Objects/Shortcuts/{GlobalShortcuts,ShortcutHelp,ListShortcuts,Kbd,ShortcutHint}`; контекст — `lib/shortcuts/ShortcutsContext.tsx`.
- `Dashboard/CommandPalette/*`; реестр — `lib/dashboard-search/registry.ts`.

### 3.7 Dashboard-компоненты

`components/Dashboard/`:
- `Home/{DashboardHome,RecentCourses,RecentMembers,ContentOverview,UsageOverview}`.
- `Pages/Course/*` (структура, general, access, contributors, certification, SEO, schedule).
- `Pages/Path/*`, `Pages/Community/*`, `Pages/Podcast/*`, `Pages/Org/*`, `Pages/Users/*` (OrgUsers, OrgRoles, OrgUserGroups, OrgAccess, OrgUsersAdd, Security).
- `Shared/{FeatureGate,PlanRestricted/UpgradeModalContext,DashTabBar}`.
- `Onboarding/*` (WelcomeModal, OnboardingTracker, LaunchPlan, OnboardingVideo, cards).
- `Misc/CourseOverviewTop`.

### 3.8 Общие UI-примитивы

`components/Objects/StyledElements/`:
- `Modal`, `ConfirmationModal`, `Form`, `Toast`, `ExportToast`, `Info`, `Tooltip`, `LinkifiedText`, `Titles/TypeOfContentTitle`, `Buttons/*`, `Error/*`, `Wrappers/GeneralWrapper`.
- `components/Objects/{UserAvatar,UserProfilePopup,SafeImage,Watermark,ContentPlaceHolder,Breadcrumbs,Banners/*,Certificates/*,Media/*,Thumbnails/*}`.
- `components/ui/*` — Radix-based примитивы (dialog, dropdown, tabs, tooltip и др.).

### 3.9 Прочее

- `components/Auth/{AuthLayout,AuthBrandingPanel,AuthMobileHeader,TurnstileWidget,PasswordStrengthIndicator,CustomSignupFields,CompleteSignupFields}`.
- `components/Security/{AdminAuthorization,AuthenticatedClientElement,EERequiredScreen,HeaderProfileBox}`.
- `components/Analytics/PageViewTracker`, `components/Contexts/PostHogProvider.tsx`.
- `components/Admin/*`, `components/Landings/*`, `components/Emails/*`, `components/SEO/*`, `components/Skeletons/*`, `components/Footers/*`.
- `components/Messaging/*` (Dock, provider, conversation UI).
- `components/Playground/*`, `components/BackgroundTasks/*`.

## 4. Сервисы Web → Backend API

| Файл(ы) | Назначение | Основные endpoints |
|---|---|---|
| `services/config/config.ts` | URL API, домены, tenancy, mode, collab URL, runtime config | `instance/info` через proxy; конфиг из `NEXT_PUBLIC_*` |
| `services/utils/ts/requests.ts` | `secureFetch`, request builders, upload progress, ошибки, retry | — |
| `services/organizations/orgs.ts`, `organizations/invites.ts` | Организации, приглашения | `/orgs`, `/orgs/slug/{slug}`, `/orgs/{id}/invites` |
| `services/org/orgResolution.ts` | Server-side выбор организации | `/orgs/slug/{slug}` |
| `services/auth/{auth,authMethods,cookies,sso,redirects,sessionMarker}.ts` | Auth-обёртки, SSO, cookie-имена, `postAuthPathForSession` (роль → `/dash` или `/cabinet`) | `/auth/*`, `/users/session` |
| `services/users/users.ts` | Профиль, пользователи | `/users/*` |
| `services/roles/roles.ts` | Роли | `/roles` |
| `services/usergroups/usergroups.ts` | Группы и ресурсы | `/usergroups` |
| `services/courses/{courses,chapters,activities,activity,assignments,certifications,drip,updates,transfer,migration,dynamicContent}.ts` | Курсы и контент | `/courses`, `/chapters`, `/activities`, `/assignments`, `/certifications`, `/courses/export|import` |
| `services/blocks/{Video,Quiz,Pdf,Image,Audio,CodePlayground}` | Блочные загрузки/данные | `/blocks`, `/stream`, `/media` |
| `services/folders/folders.ts` | Библиотека | `/folders` |
| `services/media/{media,media-resource}.ts` | Файлы и URL | `/media`, `/content` |
| `services/paths/paths.ts` | Paths | `/paths` |
| `services/communities/{communities,discussions}.ts` | Сообщества | `/communities`, `/discussions` |
| `services/boards/{boards,playground}.ts` | Доски и board-AI | `/boards`, `/boards/playground` |
| `services/podcasts/{podcasts,episodes}.ts` | Подкасты | `/podcasts`, `/episodes` |
| `services/playgrounds/{playgrounds,generator}.ts` | Playgrounds | `/playgrounds` |
| `services/messaging/messaging.ts` | Сообщения (EE) | `/messaging/*` |
| `services/calendar/calendar.ts` | Календарь | `/calendar` |
| `services/search/search.ts` | Поиск | `/search` |
| `services/ai/{ai,generation,courseplanning,magicblocks}.ts` | AI | `/ai/*` |
| `services/mcp/mcp.ts` | MCP consent/apps | `/mcp`, `/api/v1/mcp/*` |
| `services/analytics/*` | События и хуки | `/ee/analytics/*` (EE), локальные события |
| `services/plans/plans.ts` | Планы и доступность фич | `/plans`, `resolved_features` |
| `services/billing/*` | SaaS billing UI | `/api/billing/*`, Stripe |
| `services/packs/packs.ts`, `services/orgs/usage.ts` | Пакеты и usage | `/orgs/{id}/packs`, `/orgs/{id}/usage` |
| `services/api_tokens/api_tokens.ts` | API-токены | `/orgs/{id}/api-tokens` |
| `services/webhooks/webhooks.ts` | Webhooks | `/orgs/{id}/webhooks` |
| `services/custom_domains/custom_domains.ts` | Домены | `/orgs/custom-domains` |
| `services/emails/{transactional,resend,loops,disposableEmail}.ts` | Письма/маркетинг | `/api/signup`, `/api/loops/admin`, провайдеры |
| `services/settings/*`, `services/orgs/*`, `services/users/*` | Настройки | `/users`, `/orgs/{id}` |
| `services/demo/demo.ts` | Демо-организация | `/demo/*` |
| `services/ee/{audit_logs,superadmin}.ts` | EE-функции | EE endpoints |

## 5. Hooks и утилиты

- `hooks/queries/*`: `useCourses`, `useAssignments`, `useActivity`, `useCommunity`, `useDiscussion`, `useBoards`, `usePaths`, `usePlaygrounds`, `usePodcasts`, `useTrail`, `useOrg`, `useOrgAdmin`, `useUserGroups` — TanStack Query-обёртки, ключи в `lib/query/keys.ts`.
- `hooks/{useAnalytics,usePageView,useDebounce,useContributorStatus,useIsMac}`.
- `components/Hooks/*`: `useAdminStatus`, `usePlan`, `useOnboarding`, `useCourseRights`, `useLearnHouseBranding` и др.
- `lib/`: `auth/server.ts`, `auth/events.ts`, `auth/oauthBounce.ts`, `seo/*`, `search/normalize.ts`, `site-search/*`, `dashboard-search/*`, `shortcuts/*`, `media/{embedUrl,embedSanitize,h5pUrl,mediaKind,safePlay}.ts`, `errors/*`, `eeGate.ts`, `saas.ts`, `i18n.ts`, `languages.ts`, `direction.ts`, `format.ts`, `fonts.ts`, `drip.ts`, `quiz/modes.ts`, `assignments/taskOrder.ts`, `certifications/enabled.ts`, `file-validation.ts`, `orgScripts.ts`.

## 6. BFF и безопасность на границе Web

- `app/api/v1/[...path]/route.ts` — потоковый прокси к FastAPI. Не буферизует тело, прокидывает range/SSE, не следует редиректам, отдельно обрабатывает `Set-Cookie` и `content-encoding`.
- `app/api/auth/[...path]/route.ts` — auth-прокси:
  - извлекает токены из ответов login/refresh/signup/oauth/verify-email/magic-link/MFA;
  - ставит HttpOnly cookies `LH_access`/`LH_refresh`;
  - делает fast-path refresh по `exp` access-токена;
  - обрабатывает logout, очищая host-only и domain-scoped cookies;
  - проверяет same-origin для state-changing запросов;
  - прокидывает client IP-заголовки.
- `app/api/auth/token-exchange/route.ts` — обмен кода платформы, проверка сессии, установка cookies.
- `lib/auth/server.ts` — server-side сессия без расхода refresh-токена; при отсутствии access-токена возвращает `unresolved`.
- `proxy.ts` — tenancy, cookie-контекст, рерайты, canonical URL, embed/board/editor обходы, health, sitemap/robots/feeds, open-redirect защита.
- **Phase 2 access gate:** `proxy.ts` редиректит любой запрос без `LH_access`/`LH_refresh` на `/login` (кроме `/login`, `/register`, `/auth/*`, health). `/signup` → `/login`.
- **Access request UI:** `app/auth/login/login.tsx` (только вход), `app/auth/register/*` (свободная регистрация, автовход), `services/auth/redirects.ts` (роль → `/dash` или `/cabinet`).
- **Student cabinet:** `app/orgs/[orgslug]/(withmenu)/cabinet/page.tsx` — агрегирует `/trail` и `/calendar`; ссылка «My learning» в `HeaderProfileBox`.

## 7. Сквозные зависимости

```text
Providers
  └── SessionProvider (AuthContext)
        └── OrgProvider (slug → /orgs/slug/{slug})
              ├── resolved_features ← backend feature resolver
              ├── SessionGate / AdminAuthorization
              ├── OrgMenu + DASHBOARD_MENU_ITEMS (featureKey/available)
              ├── Page components → services/* → /api/v1/*
              └── Messaging / Podcast / Course / Community providers

FeatureGate/PlanBadge ← resolved_features / /plans
AdminAuthorization ← useAdminStatus ← session roles + org rights
Board UI ← Collab WS (Hocuspocus) + /boards membership + ydoc API
Editor ← activities/blocks API + versioning + AI (optional)
```

### Критичные общие точки

- **Access gate — единая точка.** `proxy.ts` не пускает браузер к shell без cookie `LH_access`/`LH_refresh`; `POST /auth/register` создаёт активного пользователя с ролью студента, после чего Web автоматически входит и ведёт в `/cabinet`. Пароль, MFA и magic link работают без отдельных проверок доступа.

1. **`OrgContext`** — почти каждая страница читает `org.config.config` (v1 или v2), `resolved_features`, `plan`. Ошибка загрузки организации ломает навигацию и feature gates.
2. **`LHSessionContext`/`AuthContext`** — единый источник токена и ролей; 401-обработка централизована в `services/utils/ts/requests.ts` и `AuthFetchInterceptor`.
3. **`getAPIUrl()`/`getServerAPIUrl()`** — разное поведение на клиенте и сервере; на клиенте возможен относительный `/api/v1/`, на сервере — внутренний URL.
4. **`resolved_features`** — backend-вычисленный набор доступных фич; UI использует его и для меню, и для скрытия табов. В OSS EE-only фичи всегда `enabled=false`.
5. **`@ee/*` alias** — build-time выбор между `apps/web/ee` и `apps/web/ee-stub` (`next.config.js`). В OSS-сборке подключены заглушки, часть страниц вызывает `notFound()`.
6. **`proxy.ts`** — обязательный слой для tenancy, cookie и публичных URL; без него внутренние `/orgs/...` не совпадают с внешними.

## 8. Наблюдения о сложности (без решений об удалении)

- **Две модели конфигурации организации.** Код читает и `config.general.*`/`config.features.*` (v1), и `config.customization.*`/`admin_toggles`/`overrides` (v2). Это видно в `orgSettings`, `OrgContext`, `resolve.py`. Любые изменения конфигурации должны учитывать оба формата.
- **Три источника навигации.** `DASHBOARD_MENU_ITEMS` (dashboard), `useOrgMenuItems` (публичное меню), `lib/site-search/registry.ts` (палитра/шорткаты). Они пересекаются, но не генерируются из одного места.
- **Дублирование auth-обёрток.** `services/auth/auth.ts` содержит прямые вызовы backend (`loginAndGetToken`, `logout`, refresh), а BFF `/api/auth/*` — второй путь. Часть функций помечена в комментарии как «REMAINING CLEANUP». Оба пути сосуществуют.
- **Два аккаунт-контура.** Org-scoped `/account/*` (реально доступен) и SaaS hub `(hub)/account` (недоступен в OSS). Похожие названия, разные layout и API.
- **Два редактора активности.** Встроенный редактор в dashboard и полноэкранный `/editor/course/...`; оба используют один `Editor`, но разные оболочки/права.
- **UI-гейты продублированы с backend.** Plan/feature проверки есть и в `resolved_features`, и в `FeatureGate`, и в тарифных `requiresPlan`; рассинхрон возможен.
- **EE-заглушки.** Большое число `@ee` импортов в обычных страницах (`Atlas`, `Analytics`, `Payments`, `LiveSessions`, `SCORM`, `LTI`). В OSS это либо пустой компонент, либо `notFound()`, либо скрытая вкладка.
- **Многослойная обработка ошибок.** `errorHandling`, `classifyError`, `ErrorShell`, `ErrorUI`, Sentry noise-фильтры, глобальные error boundaries — полезно, но требует внимания при изменении API-контрактов.
- **i18n и направление текста.** 20+ локалей, RTL-провайдер, `OrgLanguageSync`; строки часто имеют fallback `defaultValue`, что затрудняет поиск неиспользуемых ключей.
- **Большие клиентские компоненты.** `DashLeftMenu`, `AuthContext`, `courses/client.tsx`, `OrgEdit*` содержат много условной логики и feature-проверок; ручной обзор полезен до любых изменений.
