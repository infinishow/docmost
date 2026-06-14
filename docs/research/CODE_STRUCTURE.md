# Docmost 코드 구조

이 문서는 현재 Docmost 코드베이스의 큰 구조와, 기능을 추적할 때 따라가면 좋은 주요 경로를 정리합니다.

## 저장소 구조

Docmost는 Nx + pnpm workspace 기반의 monorepo입니다.

```text
apps/
  server/        NestJS + Fastify API 서버
  client/        Vite + React 프론트엔드

packages/
  editor-ext/    Tiptap/ProseMirror 에디터 확장 패키지
  ee/            Enterprise 패키지/서브모듈 영역
```

루트 `package.json`에서 주요 workspace 스크립트를 관리합니다.

```bash
pnpm dev          # client와 server를 개발 모드로 함께 실행
pnpm server:dev   # API 서버 실행
pnpm client:dev   # 프론트엔드 실행
pnpm build        # Nx로 workspace 프로젝트 빌드
```

## 서버

서버 진입점은 `apps/server/src/main.ts`입니다. Fastify adapter로 Nest 애플리케이션을 만들고 다음 항목들을 설정합니다.

- `/api` 전역 prefix
- Fastify cookie, multipart, IP, custom content-type 처리
- websocket Redis adapter
- 전역 validation pipe
- 전역 response interceptor
- iframe/frame header
- workspace 판별 pre-handler

최상위 모듈 연결은 `apps/server/src/app.module.ts`에 있습니다.

```text
apps/server/src/
  core/           제품 도메인 모듈
  database/       Kysely DB 연결, repo, migration, generated DB types
  integrations/   외부 시스템 및 인프라 모듈
  collaboration/  Hocuspocus/Yjs 협업 서버
  ws/             Socket.IO websocket 지원
  common/         공통 guard, decorator, helper, interceptor, logger
  ee/             동적으로 로드되는 enterprise module
```

### Core 모듈

`apps/server/src/core`에는 주요 제품 도메인이 들어 있습니다.

```text
auth
workspace
user
space
page
comment
attachment
search
share
group
label
favorite
notification
watcher
session
```

서버 feature는 대체로 다음 패턴을 따릅니다.

```text
*.module.ts      Nest dependency wiring
*.controller.ts  HTTP API endpoint
services/*.ts    비즈니스 로직
dto/*.ts         request/response validation 및 shape
database/repos/* Kysely 기반 DB 접근
```

예를 들어 page 기능은 다음 파일들로 나뉩니다.

```text
apps/server/src/core/page/page.module.ts
apps/server/src/core/page/page.controller.ts
apps/server/src/core/page/services/page.service.ts
apps/server/src/core/page/dto/*
apps/server/src/database/repos/page/page.repo.ts
```

### 데이터베이스

`apps/server/src/database/database.module.ts`에서 Kysely + Postgres 연결을 설정합니다. Repository provider들을 전역으로 등록하고, production 환경에서는 애플리케이션 부팅 시 migration을 자동 실행합니다.

Repository 위치:

```text
apps/server/src/database/repos/
```

생성된 DB 타입 위치:

```text
apps/server/src/database/types/
```

Migration 위치:

```text
apps/server/src/database/migrations/
```

## 클라이언트

프론트엔드 진입점은 `apps/client/src/main.tsx`입니다. 여기서 다음 provider들을 설정합니다.

- React Router
- Mantine
- Mantine modals / notifications
- TanStack Query
- Helmet
- i18n
- cloud mode에서 PostHog

최상위 라우팅은 `apps/client/src/App.tsx`에 모여 있습니다.

```text
apps/client/src/
  pages/          route 단위 page
  features/       도메인 feature 폴더
  components/     공통 UI, layout, settings component
  ee/             Enterprise UI 기능
  lib/            API client, config, route, 공통 utility
  hooks/          공통 React hook
  styles/         전역 style
```

### Feature 패턴

클라이언트 feature는 보통 다음 구조를 가집니다.

```text
features/<domain>/
  components/     feature 전용 UI
  services/       Axios API 함수
  queries/        TanStack Query hook
  types/          TypeScript 도메인 타입
  hooks/          feature 전용 hook
```

예시:

```text
apps/client/src/features/page/services/page-service.ts
apps/client/src/features/page/queries/page-query.ts
apps/client/src/features/page/types/page.types.ts
apps/client/src/features/page/components/
```

공통 API client는 `apps/client/src/lib/api-client.ts`입니다. `baseURL: "/api"`를 사용하며, 인증 실패 시 로그인 페이지로 보내거나 workspace setup으로 보내는 response interceptor가 있습니다.

## 에디터

에디터의 재사용 가능한 핵심 로직은 별도 workspace 패키지로 분리되어 있습니다.

```text
packages/editor-ext/
```

이 패키지는 workspace 내부에서 `@docmost/editor-ext`로 사용되며, Tiptap/ProseMirror 확장들을 포함합니다.

```text
packages/editor-ext/src/lib/
  attachment/
  audio/
  callout/
  columns/
  custom-code-block/
  image/
  markdown/
  math/
  page-break/
  pdf/
  table/
  transclusion/
  video/
```

에디터 UI는 주로 다음 위치에 있습니다.

```text
apps/client/src/features/editor/
```

서버 쪽 저장 및 협업 처리는 주로 다음 경로와 연결됩니다.

```text
apps/server/src/core/page/
apps/server/src/collaboration/
```

## 요청 흐름 예시

페이지 조회 요청은 대략 다음 흐름을 따릅니다.

```text
React route/page
  -> apps/client/src/features/page/queries/page-query.ts
  -> apps/client/src/features/page/services/page-service.ts
  -> POST /api/pages/info
  -> apps/server/src/core/page/page.controller.ts
  -> apps/server/src/core/page/services/page.service.ts
  -> apps/server/src/database/repos/page/page.repo.ts
  -> Kysely를 통해 Postgres 조회
```

## 기능을 추적하는 방법

특정 제품 기능을 분석하거나 수정할 때는 보통 이 순서가 좋습니다.

1. `apps/client/src/App.tsx`에서 route를 찾습니다.
2. 연결된 `apps/client/src/pages` 파일을 엽니다.
3. import를 따라 `apps/client/src/features/<domain>`으로 들어갑니다.
4. `queries/`에서 TanStack Query cache 동작을 확인합니다.
5. `services/`에서 API endpoint 이름과 payload를 확인합니다.
6. 서버의 `apps/server/src/core/<domain>` 아래 controller를 찾습니다.
7. service에서 비즈니스 규칙을 읽습니다.
8. `apps/server/src/database/repos` 아래 repo에서 SQL 동작을 확인합니다.
9. 에디터 콘텐츠와 관련된 기능이면 `apps/client/src/features/editor`, `packages/editor-ext`, `apps/server/src/collaboration`도 함께 봅니다.

## Enterprise 로딩

서버는 `apps/server/src/ee/ee.module`에서 enterprise module을 동적으로 로드합니다. `CLOUD=true` 상태에서 enterprise module 로딩에 실패하면 프로세스가 종료됩니다. 클라이언트의 enterprise UI는 `apps/client/src/ee` 아래에 모여 있습니다.

## 로컬 커스터마이징

이 checkout에는 upstream Docmost에는 없는 로컬 커스터마이징 파일들도 포함되어 있습니다.

```text
.claude/
.workflow/
workflow_docs/
docs/CUSTOMIZATION_PLAN.md
scripts/deploy.sh
scripts/verify-deployment.sh
docker-compose.production.yml
```

upstream과 비교할 때 이 파일들은 로컬 fork에서 추가된 변경으로 보면 됩니다.
