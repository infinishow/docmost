# Review Log: sso-oidc (Specify)

## Review #2 (v2)
**Status**: approved
**Issues**: None — all Review #1 blocking issues resolved in v2.

## Review #1 (v1 → v2) — resolved
**Status**: needs_revision → resolved
**Issues**:
- [x] RI-1 (Viewpoint:Technical Feasibility): 스펙은 env-var 전용 설정을 가정하지만, 코드베이스에 이미 auth_providers/auth_accounts DB 스키마 존재. 기존 스키마 활용 방식으로 R-3, R-6 수정 필요
- [x] RI-2 (Viewpoint:Clarity): R-3 환경변수 이름과 포맷 미정의. 정확한 변수명과 형식 명시 필요
- [x] RI-3 (Viewpoint:Clarity): R-5 계정 연결 후 기존 패스워드 로그인 가능 여부 미명시
- [x] RI-4 (Viewpoint:Clarity): R-2 딥링크에서 로그인 시작 시 원래 URL로 돌아가는 동작 미정의
- [x] RI-5 (Viewpoint:User Scenario): Google 동의 화면에서 거부 시 사용자 UX 미정의
- [i] RI-6 (Viewpoint:Clarity): R-4 자동 생성 사용자의 기본 역할 미명시
- [i] RI-7 (Viewpoint:User Scenario): SSO 전용 사용자(패스워드 없음)가 비밀번호 재설정 시도 시 동작 미정의
- [i] RI-8 (Viewpoint:User Scenario): Google 로그인 버튼 접근성(aria-label, 키보드, 브랜딩 가이드라인)
- [i] RI-9 (Viewpoint:Technical Feasibility): passport-google-oauth20 이미 package.json에 설치됨
- [i] RI-10 (Viewpoint:Technical Feasibility): Fastify 어댑터 호환성 — Design 단계에서 고려
