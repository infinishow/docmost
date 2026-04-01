# Design: Google SSO (OAuth) 인증
<!-- workflow: design | draftCount: 2 | status: in_progress -->

> Spec: @workflow_docs/spec/sso-oidc.md
> Date: 2026-04-01

---

## Approach Summary

기존 `auth_providers`/`auth_accounts` DB 스키마와 프론트엔드 `SsoLogin` 컴포넌트를 최대한 활용한다. 서버 시작 시 환경변수에서 Google provider를 `auth_providers`에 seed하고 `GOOGLE_ALLOWED_DOMAINS`를 `workspace.emailDomains`에 동기화한다. 새로운 `GoogleOAuthModule`을 `AuthModule`에 등록하여 Passport 전략 + 콜백 컨트롤러를 구현한다. 콜백 후 `SessionService.createSessionAndToken()`으로 세션 생성 + JWT 발급하고, `EnvironmentService`를 주입하여 기존과 동일한 HTTP-only 쿠키를 설정한다. 프론트엔드는 기존 EE `SsoLogin` 컴포넌트가 `authProviders` 배열을 자동 렌더링하므로 추가 작업 불필요.

## Alternatives Analysis

| Alternative | Pros | Cons | Verdict |
|-------------|------|------|---------|
| A: 기존 DB 스키마 활용 + env seed | upstream 호환, 프론트엔드 재사용, 일관된 데이터 모델 | seed 동기화 로직 필요 | ✅ Adopted |
| B: 순수 환경변수 (DB 무시) | 구현 단순 | 프론트엔드 재사용 불가, 이중 경로 | ❌ |

> **Adoption rationale**: 기존 `getWorkspacePublicData()`가 `auth_providers`에서 활성 프로바이더를 자동 반환하므로, DB에 레코드만 넣으면 프론트엔드 SSO 버튼이 자동 표시된다. 이중 인프라 구축 없이 최소 변경으로 목표 달성 가능.

## Change Plan

| # | File | Changes | Reference Pattern | Related AC |
|---|------|---------|-------------------|------------|
| 1 | `apps/server/src/core/auth/google-oauth/google-oauth.module.ts` | 새 모듈: GoogleStrategy, Controller, Service 등록 | `auth.module.ts:AuthModule` | R-1, R-2 |
| 2 | `apps/server/src/core/auth/google-oauth/google-oauth.strategy.ts` | passport-google-oauth20 전략, 콜백 검증 로직 | `strategies/jwt.strategy.ts:JwtStrategy` | R-1, R-2 |
| 3 | `apps/server/src/core/auth/google-oauth/google-oauth.controller.ts` | GET `/api/sso/google/login` (인증 시작), GET `/api/sso/google/callback` (콜백 처리). SessionService로 세션 생성, EnvironmentService로 동일 쿠키 설정 | `auth.controller.ts:AuthController.setAuthCookie` | R-1, R-2, R-3 |
| 4 | `apps/server/src/core/auth/google-oauth/google-oauth.service.ts` | 사용자 조회/생성, auth_accounts 연결, validateAllowedEmail() 재사용 도메인 검증 | `services/auth.service.ts:AuthService` | R-4, R-5, R-3 |
| 5 | `apps/server/src/core/auth/google-oauth/google-oauth-seed.service.ts` | 서버 시작 시 환경변수 → auth_providers seed/sync + workspace.emailDomains 동기화 | `services/signup.service.ts:SignupService` (DB insert 패턴) | R-3, R-6 |
| 6 | `apps/server/src/core/auth/google-oauth/guards/google-auth.guard.ts` | AuthGuard('google') 래퍼 | `guards/setup.guard.ts:SetupGuard` | R-1 |
| 7 | `apps/server/src/integrations/environment/environment.service.ts` | Google OAuth 환경변수 getter 3개 추가 | 기존 getter 패턴 (e.g., `getAppUrl()`) | R-6 |
| 8 | `apps/server/src/core/auth/auth.module.ts` | GoogleOAuthModule을 AuthModule에서 조건부 import | `auth.module.ts:AuthModule` 기존 imports 패턴 | R-6 |

## Implementation Slices

### Group A: Backend Infrastructure [R-3, R-6]

#### Slice A-1: EnvironmentService + Google Provider Seed
- **Test intent**: 환경변수에서 Google OAuth 설정을 읽고, 서버 시작 시 auth_providers에 Google provider 생성/동기화 + workspace.emailDomains에 GOOGLE_ALLOWED_DOMAINS 동기화 검증
- **Changed files**: `environment.service.ts`, `google-oauth-seed.service.ts`, `google-oauth.module.ts`
- **Precondition**: None

### Group B: OAuth Flow [R-1, R-2, R-4, R-5]

#### Slice B-1: Google Passport Strategy + Auth Guard
- **Test intent**: Google OAuth 전략이 등록되고, 인증 시작 엔드포인트가 Google로 리다이렉트하는지 검증
- **Changed files**: `google-oauth.strategy.ts`, `google-auth.guard.ts`, `google-oauth.controller.ts`
- **Precondition**: Slice A-1

#### Slice B-2: Callback 처리 + 사용자 생성/연결
- **Test intent**: Google 콜백 후 신규 사용자 생성(member 역할), 기존 사용자 auth_accounts 연결, SessionService로 세션 생성 + JWT 발급, EnvironmentService로 HTTP-only 쿠키 설정, return URL 리다이렉트가 정상 동작하는지 검증
- **Changed files**: `google-oauth.service.ts`, `google-oauth.controller.ts`
- **Precondition**: Slice B-1

### Group C: Domain Validation + Module Registration [R-3, R-7]

#### Slice C-1: 도메인 검증 + 에러 처리 + 모듈 등록
- **Test intent**: validateAllowedEmail()로 허용되지 않은 도메인 거부, Google 동의 거부/API 에러 시 로그인 페이지로 에러 리다이렉트, 환경변수 미설정 시 GoogleOAuthModule 미로딩 검증
- **Changed files**: `google-oauth.service.ts`, `auth.module.ts`
- **Precondition**: Slice B-2

## AC Coverage

| AC | Slice | Status |
|----|-------|--------|
| R-1 | B-1, B-2 | ⬜ |
| R-2 | B-2 | ⬜ |
| R-3 | A-1, C-1 | ⬜ |
| R-4 | B-2 | ⬜ |
| R-5 | B-2 | ⬜ |
| R-6 | A-1, C-1 | ⬜ |
| R-7 | C-1 | ⬜ |
| C-1 | B-1 (state param) | ⬜ |
| C-2 | B-2 (기존 cookie 방식) | ⬜ |
| C-3 | 전체 (신규 파일 위주) | ⬜ |
| C-4 | C-1 (조건부 로딩) | ⬜ |

## Test Strategy

- **Unit**: GoogleOAuthService — 사용자 조회/생성/연결 로직, 도메인 검증. DB는 mock
- **Integration**: 실제 콜백 엔드포인트 E2E 테스트는 Google OAuth 의존성으로 인해 수동 검증
- **Manual**: Google 동의 화면 → 콜백 → 로그인 완료 전체 플로우, 도메인 거부 시 에러 메시지, 환경변수 미설정 시 버튼 미표시

## Risks / Open Questions

- [x] EE SsoLogin 컴포넌트가 CE 빌드에 포함되는가? → **Yes, 확인 완료**. login-form.tsx에서 직접 import
- [x] `/api/sso/google` 경로가 main.ts에서 workspaceId 체크 제외되어 있는가? → **Yes, 확인 완료**
- [x] 도메인 검증 소스: `GOOGLE_ALLOWED_DOMAINS` → seed 시 `workspace.emailDomains`에 동기화, 기존 `validateAllowedEmail()` 재사용
- [x] `setAuthCookie` 재사용: SessionService + EnvironmentService를 새 컨트롤러에 주입하여 동일 쿠키 설정 로직 구현
- [x] Google API 장애 대응: Passport 기본 타임아웃 + 콜백 에러 시 로그인 페이지로 에러 쿼리파라미터와 함께 리다이렉트

## External Dependencies

- Google OAuth 2.0 API (accounts.google.com) — 장애 시 Passport 기본 타임아웃 적용, 에러는 로그인 페이지로 리다이렉트
- passport-google-oauth20 (이미 설치됨)

---
## Change History

| Version | Date | Changes | Reason |
|---------|------|---------|--------|
| v1 | 2026-04-01 | 초기 작성 | — |
| v2 | 2026-04-01 | 도메인 검증 소스 명확화, setAuthCookie 재사용 방안, AuthModule에서 등록, Google API 장애 대응, SessionService 명시 | Review #1 반영 |
