# Spec: Google SSO (OAuth) 인증
<!-- workflow: specify | draftCount: 1 | status: in_progress -->

> Date: 2026-04-01

---

## Problem

100명+ 팀에서 Docmost를 사용할 때 수동 계정 관리는 비현실적이다. Google Workspace를 IdP로 활용한 SSO 로그인을 제공하여, 허용된 도메인의 구성원이 Google 계정으로 즉시 로그인하고 자동으로 계정이 생성되도록 한다.

## Requirements

- [ ] [R-1] 사용자는 로그인 화면에서 "Google로 로그인" 버튼을 클릭하여 Google OAuth 플로우를 시작할 수 있다
- [ ] [R-2] Google 인증 완료 후 콜백을 처리하여 JWT를 발급하고 대시보드로 리다이렉트한다
- [ ] [R-3] 허용된 이메일 도메인 목록을 환경변수로 설정할 수 있으며, 목록에 없는 도메인은 로그인이 거부된다
- [ ] [R-4] 최초 로그인 시 Google 프로필 정보(이름, 이메일)를 기반으로 사용자 계정을 자동 생성한다
- [ ] [R-5] 이미 email/password로 가입된 이메일과 동일한 Google 계정으로 로그인 시 기존 계정에 연결한다
- [ ] [R-6] Google OAuth 관련 환경변수가 미설정이면 SSO 기능이 완전히 비활성화되고 기존 로그인만 동작한다
- [ ] [R-7] 기존 email/password 로그인은 SSO와 병행하여 계속 사용 가능하다

## Acceptance Criteria

### AC-1: Google OAuth 로그인 성공 (신규 사용자)
- Input: 허용 도메인(`bmsmile.cc`)의 Google 계정으로 최초 로그인 시도
- Expected: Google 인증 후 사용자 자동 생성, JWT 발급, 대시보드로 리다이렉트
- Verification: DB에 새 사용자 레코드 존재, 응답에 HTTP-only JWT 쿠키 포함, 대시보드 렌더링 확인

### AC-2: Google OAuth 로그인 성공 (기존 사용자)
- Input: 이미 email/password로 가입된 이메일과 동일한 Google 계정으로 로그인
- Expected: 기존 계정에 Google 인증 연결, JWT 발급, 대시보드로 리다이렉트
- Verification: DB에 새 사용자 생성 없음, 기존 사용자 ID로 JWT 발급

### AC-3: 허용되지 않은 도메인 거부
- Input: 허용 도메인 목록에 없는 이메일(예: `user@gmail.com`)로 Google 로그인 시도
- Expected: 로그인 거부, 에러 메시지 표시 ("이 도메인은 허용되지 않습니다")
- Verification: 사용자 생성 없음, 로그인 페이지로 리다이렉트 + 에러 메시지

### AC-4: 환경변수 미설정 시 SSO 비활성화
- Input: `GOOGLE_CLIENT_ID` 등 환경변수 없이 서버 실행
- Expected: 로그인 화면에 Google 로그인 버튼 미표시, 기존 로그인 정상 동작
- Verification: 로그인 페이지에 SSO 버튼 없음, email/password 로그인 정상

### AC-5: 기존 로그인 병행
- Input: SSO 활성화 상태에서 email/password로 로그인 시도
- Expected: 기존과 동일하게 정상 로그인
- Verification: 기존 로그인 플로우 변경 없음

## Edge Cases

| Situation | Expected Behavior |
|-----------|------------------|
| Google에서 이메일 claim 미반환 | 로그인 거부, "이메일 정보를 가져올 수 없습니다" 에러 |
| 허용 도메인 환경변수가 비어있음 | 모든 도메인 거부 (화이트리스트 방식) |
| Google OAuth 콜백에 에러 파라미터 포함 | 로그인 페이지로 리다이렉트 + 에러 메시지 |
| 동일 이메일로 동시에 Google/password 로그인 시도 | 각각 독립적으로 정상 처리 |

## In Scope / Out of Scope

**In Scope**:
- Google OAuth 2.0 로그인 플로우 (passport-google-oauth20)
- 환경변수 기반 설정 (Client ID, Secret, Allowed Domains)
- 사용자 자동 생성 및 기존 계정 연결
- 로그인 UI에 Google SSO 버튼 추가
- 도메인 화이트리스트 검증

**Out of Scope**:
- SAML, LDAP, 범용 OIDC 지원
- DB 기반 설정 UI (관리자 화면)
- SSO 강제 / email/password 로그인 비활성화
- MFA (IdP에서 처리)
- 여러 IdP 동시 지원
- 사용자 프로필 사진 동기화

## Constraints

- [C-1] OAuth state 파라미터를 사용하여 CSRF 공격을 방지한다
- [C-2] JWT는 기존 HTTP-only 쿠키 방식을 그대로 사용한다
- [C-3] upstream(docmost/docmost) 업데이트 충돌 최소화를 위해 기존 auth 코드 수정을 최소화하고 신규 파일 추가 위주로 구현한다
- [C-4] 환경변수 미설정 시 기존 동작에 어떠한 영향도 없어야 한다

---
## Change History

| Version | Date | Changes | Reason |
|---------|------|---------|--------|
| v1 | 2026-04-01 | 초기 작성 | — |
