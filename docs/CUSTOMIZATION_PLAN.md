# Docmost 커스터마이징 계획

> 작성일: 2026-04-01
> Fork: github.com/infinishow/docmost (upstream: docmost/docmost v0.71.0)
> 목적: 100명+ 팀의 Notion 대체를 위한 Community Edition 기능 확장

---

## 배경

Docmost Community Edition은 코어 위키/문서 협업 기능을 제공하지만, 100명+ 팀에서 Notion을 대체하려면 유료 Business/Enterprise 티어에 포함된 일부 기능이 필수적이다. 이 문서는 자체 구현할 기능과 그 우선순위를 정리한다.

### 라이선스 참고
- Docmost Community: AGPL-3.0 (수정 및 배포 가능, 소스 공개 의무)
- `/ee` 폴더: 독점 라이선스 — **참조/복사 불가**, 처음부터 자체 구현 필요

---

## Business/Enterprise 제한 기능 분석

### 전체 목록 및 우선순위

| 기능 | 유료 티어 | 우선순위 | 자체 구현 | 비고 |
|---|---|---|---|---|
| SSO (SAML, OIDC, LDAP) | Business | **P0 — 필수** | O | 100명 수동 계정 관리 불가 |
| Page-level Permissions | Business | **P0 — 필수** | △ | 구현 난이도 높음, 비용 대비 검토 필요 |
| MFA (2FA) | Business | P1 — 높음 | △ | SSO 도입 시 IdP에서 처리 가능 |
| Resolve Comments | Business | P2 — 중간 | O | 협업 편의, 없어도 운영 가능 |
| Full-text Search (첨부파일) | Business | P2 — 중간 | O | PDF/DOCX 검색, 편의 기능 |
| API Keys | Business | P2 — 중간 | O | 자동화/연동 필요 시 |
| Audit Logs | Enterprise | P3 — 낮음 | △ | 규정준수 요구 없으면 불필요 |
| AI Integration | Business | P3 — 낮음 | - | 있으면 좋지만 핵심 아님 |
| MCP Support | Business | P3 — 낮음 | - | AI 파이프라인 구축 시에만 |
| Confluence/DOCX Import | Business | P3 — 일회성 | - | 마이그레이션 시에만 |
| Enterprise Controls | Enterprise | P3 — 낮음 | - | 초기 불필요 |
| Advanced Search Engine | Business | P3 — 낮음 | - | 기본 검색으로 시작 |

---

## Phase 1: SSO 구현 (P0)

### 개요
- **목표**: OIDC 기반 SSO를 통해 Google Workspace / Keycloak 등 외부 IdP 연동
- **예상 공수**: 3~5일
- **난이도**: 중
- **기존 코드 영향**: 인증 모듈만 수정, 범위 좁음
- **유지보수 부담**: 낮음 (업데이트 시 충돌 가능성 낮음)

### 기술 접근
- Docmost는 NestJS + Passport.js (JWT, HTTP-only 쿠키) 기반
- `passport-openidconnect` 전략 추가
- 첫 로그인 시 사용자 자동 프로비저닝 (auto-create)
- 환경변수로 OIDC 설정 관리 (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` 등)

### 구현 범위
1. Passport OIDC 전략 등록
2. OIDC 콜백 엔드포인트
3. 사용자 자동 생성/매핑 로직
4. 로그인 화면에 SSO 버튼 추가 (프론트엔드)
5. 환경변수 기반 설정 (DB 설정 UI는 스킵)

### MFA 관련
- SSO 도입 시 MFA는 IdP(Google Workspace, Keycloak 등)에서 처리
- Docmost 자체 MFA 구현은 불필요 → **P1 해소**

---

## Phase 2: Page-level Permissions (P0, 보류)

### 현실적 판단

| 항목 | 내용 |
|---|---|
| 예상 공수 | 3~5주 |
| 난이도 | **높음** |
| 코드 영향 | **광범위** — DB 스키마 변경, 모든 페이지 쿼리에 권한 체크, UI 전체 |
| 유지보수 | 업데이트할 때마다 머지 충돌 예상 |
| 위험도 | 권한 버그 = 보안 사고 |

### 권장 방향
- **당분간 스페이스 단위 권한으로 운영** (부서/팀별 스페이스 분리)
- 스페이스 권한만으로 부족한 시점에 재검토
- 재검토 시 선택지:
  - A) Business 라이선스 구매 ($4,200/년, 100명 기준)
  - B) 자체 구현 (인건비 $5,000~10,000 + 지속적 유지보수)
  - C) Docmost가 Community에 해당 기능을 풀어줄 가능성 모니터링

---

## Phase 3: 추가 기능 (필요 시)

### API Keys (P2)
- NestJS에 Bearer token 인증 미들웨어 추가
- 토큰 발급/관리 엔드포인트 구현
- 기존 내부 서비스 레이어(페이지 CRUD 등)에 컨트롤러만 추가
- 예상 공수: 1~2주
- 또는 외부 서비스에서 PostgreSQL 직접 읽기 (읽기 전용 API, 2~3일)

### Resolve Comments (P2)
- 댓글 테이블에 `resolved` 필드 추가
- UI에 해결/미해결 토글
- 예상 공수: 2~3일

### Full-text Search in Attachments (P2)
- Typesense 또는 Meilisearch 연동 (서버에 이미 Meilisearch 가동 중)
- PDF/DOCX 텍스트 추출 후 인덱싱
- 예상 공수: 1~2주

---

## 비용 비교 요약

### 자체 구현 vs Business 구매

| | 자체 구현 (SSO만) | 자체 구현 (SSO + 페이지권한) | Business 구매 |
|---|---|---|---|
| 초기 비용 | ~$1,000 (인건비) | ~$6,000~11,000 (인건비) | $0 |
| 연간 비용 | $0 | $0 + 유지보수 인건비 | $4,200/년 (100명) |
| 얻는 기능 | SSO만 | SSO + 페이지권한 | SSO + 페이지권한 + MFA + API + AI + 기타 전부 |

### Notion 대비 비용

| | Notion Business | Docmost Business | Docmost Community + SSO 자체 구현 |
|---|---|---|---|
| 100명 연간 | $24,000 | $4,200 | ~$1,000 (초기) + 인프라 |
| SSO | O | O | O |
| AI | O | O | X |
| 페이지 권한 | O | O | X (스페이스 단위) |

---

## 배포 구성

### 현재 (평가용, Community Edition)
- 서버: `ssh office` (Ubuntu 22.04, 62GB RAM, 1.8TB)
- Portainer 스택으로 배포
- 포트: 13000
- DB: 기존 PostgreSQL (전용 유저 `docmost`)
- Redis: Docmost 전용 컨테이너
- 프록시: Nginx Proxy Manager → `https://docmost.bmsmile.cc/`

### 향후 (커스텀 빌드 전환 시)
- GitHub fork에서 Docker 이미지 직접 빌드
- `docker-compose.yml`의 `image:` → `build:` 변경
- CI/CD는 GitHub Actions 또는 서버 직접 빌드

---

## 실행 순서

1. **현재**: Community Edition으로 팀 평가 진행
2. **Phase 1**: SSO(OIDC) 구현 → `custom/sso` 브랜치
3. **평가 후 결정**: 페이지 권한 필요 여부에 따라 Business 구매 또는 Phase 2 진행
4. **필요 시**: API, 댓글 해결, 첨부파일 검색 등 추가 기능 구현

---

## 참고

- [Docmost GitHub](https://github.com/docmost/docmost)
- [Docmost 가격](https://docmost.com/pricing)
- [Docmost Community vs Enterprise 비교](https://wz-it.com/en/blog/docmost-community-vs-enterprise-edition/)
- [비즈니스 모델 논의 (GitHub Discussion #958)](https://github.com/docmost/docmost/discussions/958)
