# Database Phase 1 설계 리뷰 노트

작성일: 2026-06-11

이 문서는 Phase 1 server foundation spec을 작성하기 전에 확인해야 할 설계 리뷰 결과를 기록한다. 최종 spec이 아니라, spec 작성 시 반영해야 할 리스크와 결정 사항 목록이다.

## Baseline verification note

작성일: 2026-06-12

Phase 1 구현 브랜치의 전체 server Jest 실패 여부를 해석할 때는 아래 baseline 결과를 먼저 확인한다.

```text
Baseline commit
  de4820c0 docs: refine database phase 1 design

Baseline worktree
  /Users/infinishow/.config/superpowers/worktrees/docmost/database-phase-1-baseline

Commands
  pnpm install
  pnpm server:build
  pnpm --filter ./apps/server exec jest --runInBand

Result
  pnpm install: pass
  pnpm server:build: pass
  full server Jest: fail
    Test Suites: 16 failed, 8 passed, 24 total
    Tests: 6 failed, 145 passed, 151 total
```

따라서 Phase 1 전 baseline에서도 전체 server Jest는 이미 green이 아니었다. Phase 1 구현 검증 시 전체 server Jest 실패를 곧바로 Phase 1 regression으로 해석하지 않는다. 실패 원인을 비교할 때는 Phase 1 focused tests와 build 결과를 우선 확인하고, 전체 Jest 실패는 baseline과 failure signature를 대조한다.

2026-06-12 기준 baseline의 대표 실패 signature:

```text
Cannot find module 'src/integrations/queue/constants'
Cannot find module 'src/common/helpers/utils'
Cannot find module 'src/collaboration/collaboration.util'
Cannot find module 'src/common/decorators/public.decorator'
Nest can't resolve dependencies ... GroupRepo
Nest can't resolve dependencies ... KyselyModuleConnectionToken
Nest can't resolve dependencies ... ConfigService
Nest can't resolve dependencies ... JwtService
Nest can't resolve dependencies ... STORAGE_DRIVER_TOKEN
```

이 기록은 "전체 server Jest 실패가 Phase 1 구현 때문에 새로 생겼는가?"를 판단하기 위한 baseline이다. 전체 Jest harness를 고치는 작업은 Phase 1 기능 구현과 별도 범위로 취급한다.

Decision:

```text
2026-06-12
  전체 server Jest harness 수정은 database Phase 1 완료 조건에서 제외한다.
  후속 database phase에서도 같은 baseline failure를 Phase regression으로 곧바로 해석하지 않는다.
  필요하면 별도 테스트 인프라 태스크/브랜치에서 다룬다.
```

## 리뷰 대상

검토 대상은 다음 Phase 1 방향이다.

```text
Phase 1 범위
  서버 foundation only
  client UI 없음
  full-page database page type 없음
  websocket event layer 없음

모델
  DataSource를 기존 parent Page 아래에 둔다.
  data_sources.parent_page_id가 기존 Docmost page를 가리킨다.

권한
  parent page의 read/edit 권한을 database read/write 권한으로 사용한다.

API
  사용자-facing route는 /databases/*를 사용한다.
  내부 모델명은 DataSource를 유지한다.
```

## 결론

큰 방향은 유지한다.

```text
Docmost Database Phase 1 =
  기존 page 아래에 소속되는 DataSource 서버 모델/API를 먼저 만든다.
```

다만 Phase 1 spec에는 아래 항목을 반드시 반영해야 한다. 특히 parent page lifecycle, permission semantics, schema constraint는 구현 전에 고정하지 않으면 후속 phase에서 흔들릴 가능성이 높다.

## 반드시 반영할 사항

### 1. 전체 아키텍처 문서와 Phase 1 범위 충돌 정리

현재 전체 아키텍처 문서는 초기 제품 범위를 `Full-page database + Table view`로 설명한다. 반면 Phase 1은 서버 foundation only다.

Spec 작성 시 다음을 분리해야 한다.

```text
Target architecture
  최종적으로 full-page database, table view, realtime event를 포함한다.

Phase 1 contract
  서버 데이터 모델/API만 만든다.
  UI, full-page page type, websocket event는 만들지 않는다.
```

필요한 수정:

- `docs/implementation/database/ARCHITECTURE.md`에서 “초기 제품 범위”와 “Phase 1 범위”를 명확히 구분한다.
- Phase 1 spec에는 non-goal을 강하게 적는다.

### 2. Parent page lifecycle 정의

`data_sources.parent_page_id`만으로는 page lifecycle이 자동으로 해결되지 않는다. DataSource는 `pages` tree 밖의 테이블이므로, parent page 상태 변화에 대한 규칙이 필요하다.

1차 리뷰 당시 spec에서 정해야 했던 항목:

```text
Parent page soft delete
  parent page가 trash로 가면 data source도 조회/수정 불가로 본다.

Parent page restore
  parent page가 복구되면 data source도 다시 접근 가능하다.

Parent page permanent delete
  FK on delete cascade 또는 명시 삭제 정책을 정한다.

Parent page move to another space
  data_sources.space_id를 같이 갱신할지, parent page join으로만 판단할지 정한다.

Parent page duplicate
  Phase 1에서는 data source duplicate를 하지 않을지, 나중 phase로 미룰지 정한다.

Export/share/search/sidebar
  Phase 1에서 제외한다면 제외한다고 명시한다.
```

권장 결정:

```text
Phase 1에서는 parent page가 deletedAt != null이면 data source 접근을 거부한다.
Permanent delete는 FK cascade로 정리한다.
Move/duplicate/export/share/search/sidebar 통합은 Phase 2 이후로 명시 defer한다.
```

### 3. Permission semantics 정확화

“parent page 권한 상속”이라는 표현만으로는 부족하다. Docmost page 권한은 space 권한과 page restriction을 함께 본다.

Spec에 다음 절차를 명시한다.

```text
Database read API
  1. data source를 로드한다.
  2. parent page를 로드한다.
  3. parent page가 없거나 deletedAt이 있으면 NotFound 처리한다.
  4. workspaceId/spaceId 일치를 확인한다.
  5. PageAccessService.validateCanView(parentPage, user)를 호출한다.

Database write API
  1. data source를 로드한다.
  2. parent page를 로드한다.
  3. parent page가 없거나 deletedAt이 있으면 NotFound 처리한다.
  4. workspaceId/spaceId 일치를 확인한다.
  5. PageAccessService.validateCanEdit(parentPage, user)를 호출한다.
```

권장 결정:

- Phase 1에서 database 전용 권한 모델은 만들지 않는다.
- property별/view별/record별 보안 권한은 만들지 않는다.
- 모든 권한 판단은 parent page 기준으로 통일한다.

### 4. Phase 1 record는 아직 Notion item page가 아님

`data_source_records.page_id`를 nullable로 두면 Phase 1 record는 아직 Docmost page가 아니다.

따라서 Phase 1 record는 다음 기능에 참여하지 않는다.

```text
page search
backlinks
comments
mentions
watchers
page history
page-level restrictions
URL routing
본문 협업
```

Spec에는 Phase 1 record를 다음처럼 정의해야 한다.

```text
Phase 1 Record =
  structured row only
  page body 없음
  page permission 없음
  parent data source permission만 적용
```

후속 phase에서 record page를 만들 때 migration path를 정의한다.

```text
record를 page로 처음 열 때 lazy-create
또는 Phase 2/3에서 record page를 eager-create로 전환
```

### 5. Schema constraint와 index 명시

테이블 컬럼만 나열하면 구현 시 해석이 흔들린다. DDL 수준 규칙을 spec에 넣어야 한다.

필수 constraint 후보:

```text
data_sources
  parent_page_id references pages(id) on delete cascade
  workspace_id not null
  space_id not null

data_source_properties
  data_source_id references data_sources(id) on delete cascade
  type not null
  position not null
  one title property per data source

data_source_records
  data_source_id references data_sources(id) on delete cascade
  page_id references pages(id) nullable
  position not null

data_source_property_values
  record_id references data_source_records(id) on delete cascade
  property_id references data_source_properties(id) on delete cascade
  unique(record_id, property_id)

data_source_views
  data_source_id references data_sources(id) on delete cascade
  type not null
  position not null
```

필수 index 후보:

```text
data_sources(parent_page_id)
data_sources(workspace_id, space_id)
data_source_properties(data_source_id, position)
data_source_properties(data_source_id, deleted_at)
data_source_records(data_source_id, position)
data_source_records(data_source_id, deleted_at)
data_source_property_values(record_id)
data_source_property_values(property_id)
data_source_views(data_source_id, position)
```

### 6. workspace_id / space_id drift 방지

`data_sources`가 `workspace_id`, `space_id`, `parent_page_id`를 모두 가지면 parent page와 값이 어긋날 수 있다.

1차 리뷰 당시 다음 중 하나를 정해야 했다.

```text
Option A
  data_sources에 workspace_id/space_id를 저장한다.
  생성 시 parent page 값으로 채운다.
  parent page move 시 data_sources도 같이 갱신한다.

Option B
  data_sources에는 parent_page_id만 저장한다.
  workspace/space는 parent page join으로 계산한다.
```

권장 결정:

```text
Phase 1에서는 workspace_id/space_id를 저장하되,
모든 생성/조회/수정에서 parent page와 일치하는지 검증한다.
parent page move 연동은 Phase 1 spec에서 defer 또는 명시 구현 중 하나로 결정한다.
```

2차 리뷰 반영 후 현재 결정은 `workspace_id`/`space_id`를 저장하고, page move-to-space 시 `data_sources.space_id`도 같은 transaction에서 동기화하는 것이다.

### 7. API route와 ID 의미 명확화

`/databases/*` route는 사용자-facing 이름으로는 괜찮다. 다만 Phase 1에서 `databaseId`가 실제로 무엇을 가리키는지 명확해야 한다.

Spec에 다음을 적는다.

```text
Phase 1 API의 databaseId는 data_sources.id다.
Phase 1에는 database block id나 linked database container id가 없다.
후속 full-page database도 기존 pages row가 data_sources row 하나를 소유하는 방식으로 확장한다.
View id는 data_source_views.id다.
Record id는 data_source_records.id다.
```

권장 route style:

```text
POST /databases/create
POST /databases/info
POST /databases/update
POST /databases/delete

POST /databases/properties/create
POST /databases/properties/update
POST /databases/properties/delete

POST /databases/records/create
POST /databases/records/update
POST /databases/records/delete
POST /databases/records/query

POST /databases/values/update

POST /databases/views/create
POST /databases/views/update
POST /databases/views/delete
```

이 route style은 기존 Docmost core controller의 action-style POST 패턴과 맞춘다.

### 8. Query/pagination 권한 전략

Phase 1에서는 record별 page 권한이 없다. 따라서 query permission은 data source parent page에서 한 번 판단한다.

Spec에 다음을 명시한다.

```text
Phase 1 query permission
  data source parent page를 볼 수 있으면 해당 data source의 record query 가능
  record별 permission filtering 없음
```

후속 phase 주의:

```text
record.page_id가 생기고 record-level permission을 지원하면
pagination 전에 permission filtering을 어떻게 할지 다시 설계해야 한다.
```

### 9. Version 정책 명확화

Phase 1에는 version column을 넣되, optimistic concurrency를 public contract로 만들지 않는다.

Spec에 다음을 적는다.

```text
Phase 1 write conflict
  same cell write는 last-write-wins
  server는 update 시 version을 증가시킨다.
  client가 baseVersion을 보내도 Phase 1에서는 사용하지 않는다.
  409 conflict는 Phase 3 이후로 미룬다.
```

또는 더 단순하게:

```text
Phase 1 DTO에는 baseVersion을 넣지 않는다.
```

권장 결정은 후자다. 구현하지 않을 동작을 API에 먼저 노출하지 않는다.

### 10. Property value normalization 규칙

`value_json`과 helper column을 함께 쓰려면 타입별 저장 규칙이 필요하다.

Spec에서 최소한 다음 타입별 규칙을 정한다.

```text
title/text/url/email/phone
  value_json에 원본 저장
  text_value에 검색/정렬용 문자열 저장

number
  value_json에 원본 저장
  number_value에 numeric 값 저장

checkbox
  value_json에 원본 저장
  bool_value에 boolean 저장

date
  value_json에 원본 저장
  date_value에 start date 저장

select
  value_json에는 option id 저장
  1차 리뷰 당시 text_value에 option label 또는 sort key 중 무엇을 저장할지 미정
  2차 리뷰 반영 후 현재 결정은 option sortKey 저장

multi_select
  value_json에는 option id 배열 저장
  helper column 사용 여부는 Phase 1에서 제한 가능

person
  value_json에는 user id 배열 저장
  helper column 사용 여부는 Phase 1에서 제한 가능
```

권장 결정:

- Phase 1 filter/sort 지원 타입을 제한한다.
- 지원하지 않는 타입의 sort/filter는 BadRequest로 거부한다.

### 11. Product module naming

`core/database`는 제품 개념으로는 자연스럽지만, 이미 `src/database`가 DB infra 모듈로 존재한다.

선택지:

```text
Option A
  apps/server/src/core/database

Option B
  apps/server/src/core/databases

Option C
  apps/server/src/core/data-source
```

권장 결정:

```text
core/databases
  사용자-facing 기능명과 맞고,
  infra src/database와 이름 충돌을 조금 줄인다.

database/repos/data-source
  persistence 계층은 실제 모델명에 맞춘다.
```

### 12. Search/audit/activity는 Phase 1에서 명시 defer

Phase 1의 mutation이 search, audit, notification, watcher, websocket event에 반영되지 않으면 운영 관점에서 보이지 않는 변경이 된다.

Spec에 다음을 명시한다.

```text
Phase 1 deferred integrations
  search indexing
  audit events
  notification
  watcher
  websocket event
  activity feed
```

다만 security/audit 요구가 있으면 database create/update/delete만 최소 audit event로 남기는 선택지도 있다. 이 경우 별도 scope 증가로 본다.

## Phase 1 spec 작성 시 체크리스트

Spec 작성 전 다음 질문에 답해야 한다.

```text
1. Phase 1은 UI/event 없이 server foundation only라고 명확한가?
2. parent page 삭제/복구/영구삭제/이동/복제 정책이 정해졌는가?
3. 모든 read/write API가 PageAccessService를 어떻게 호출하는지 적혀 있는가?
4. Phase 1 record가 아직 page가 아니라는 점이 명확한가?
5. DDL constraint와 index가 충분히 구체적인가?
6. databaseId가 data_sources.id라는 점이 명확한가?
7. version column은 있으나 409 conflict는 없다는 점이 명확한가?
8. property value 타입별 normalization 규칙이 있는가?
9. core module 이름을 무엇으로 할지 정했는가?
10. search/audit/notification/websocket defer 범위가 명확한가?
```

## 2차 설계 리뷰 반영 기록

작성일: 2026-06-11

Phase 1 `DESIGN.md` 작성 후 별도 리뷰에서 다음 보강점이 나왔다. 구현 계획으로 넘어가기 전에 spec에 반영한다.

### 반영한 결정

```text
Parent page move
  data_sources.space_id를 유지한다.
  page move-to-space transaction에서 parent_page_id가 이동 page 집합에 포함된 data source의 space_id도 동기화한다.
  drift가 발견되면 외부 응답은 NotFound, 서버 log는 integrity error로 처리한다.

DataSource delete lifecycle
  /databases/delete는 data_sources.deleted_at만 soft delete한다.
  child rows는 즉시 soft delete하지 않는다.
  모든 child API는 active data source 조건으로 NotFound 처리한다.
  hard delete는 FK cascade에 맡긴다.

Future full-page database mapping
  별도 container table을 만들지 않는다.
  기존 pages row가 data_sources row 하나를 소유한다.
  Phase 1 parent_page_id는 장기적으로도 owner page다.

Permission matrix
  readData/writeData/writeSchema/writeView를 개념적으로 분리한다.
  Phase 1에서는 readData는 validateCanView, 나머지는 validateCanEdit으로 매핑한다.
  /databases/info 응답에 capability flags를 포함한다.

Property value integrity
  data_source_property_values에 data_source_id를 추가한다.
  record/property/value가 같은 data source에 속하는지 DB constraint 또는 service/repo 테스트로 보장한다.

Position
  pages.position과 같은 varchar fractional indexing key를 사용한다.
  order는 COLLATE "C"와 id tie-breaker를 사용한다.

Select option
  cell value_json에는 stable option id를 저장한다.
  helper text_value에는 option sortKey를 저장한다.
  option delete는 archived 처리한다.

Query contract
  view filter와 request filter는 AND로 결합한다.
  request sort는 view sort를 대체한다.
  filter AST, sort shape, null ordering, case sensitivity, date timezone 규칙을 명시한다.

Testing
  service unit test만으로 완료하지 않는다.
  migration, permission leakage, lifecycle, soft delete filtering, query SQL, integrity 테스트를 필수로 둔다.
```

### 구현 계획으로 넘기기 전 남은 확인

```text
1. Composite FK를 migration에서 그대로 구현할지, DB constraint와 service validation 조합으로 나눌지.
2. page move-to-space 동기화를 PageService에 직접 넣을지, data source repo/service를 주입해 처리할지.
3. cursor pagination helper가 multi sort + nulls last를 얼마나 직접 지원하는지.
```

위 항목은 spec의 방향을 바꾸는 질문이 아니라 implementation plan에서 파일 단위 작업으로 쪼갤 때 확인할 항목이다.
