# Docmost Database 구현 아키텍처

작성일: 2026-06-11

이 문서는 Docmost 위에 Notion식 Database 기능을 구현한다고 가정했을 때의 전체 아키텍처 초안이다. 한 번에 모든 기능을 구현하는 것이 아니라, phase별로 확장 가능한 구조를 먼저 잡는 것을 목표로 한다.

주의: 이 문서는 target architecture와 배경 설계를 설명한다. Phase 1 구현 계약의 source of truth는 `docs/implementation/database/phase-1/DESIGN.md`다. 둘 사이에 module 이름, API route, DTO 세부사항이 다르면 Phase 1에서는 `DESIGN.md`를 따른다.

관련 문서:

- `docs/research/NOTION_DATABASE_RESEARCH.md`
- `docs/research/CONCURRENCY_RESEARCH.md`
- `docs/implementation/database/phase-1/DESIGN.md`
- `docs/implementation/database/phase-1/MODEL_EXPLAINED.md`

## 결론

Docmost Database는 다음 방향으로 설계하는 것이 적절하다.

```text
본문 협업
  기존 PageEditor + Hocuspocus + Yjs 재사용

Database property/grid
  서버 API + Postgres transaction + websocket event

데이터 모델
  Data source 중심 모델

사용자 기능 MVP
  Full-page database + Table view

Phase 1 범위
  Server foundation only
  UI, full-page database page type, websocket event 제외
```

즉, database grid 전체를 하나의 Yjs 문서로 만들지 않는다. 구조화 데이터는 서버가 단일 판정 지점이 되어 저장하고, 변경 결과만 websocket event로 다른 클라이언트에 전파한다.

## 설계 목표

### 목표

- Docmost 안에서 Notion식 database table을 만들 수 있다.
- Database row는 property 값을 가진 record로 저장된다.
- 같은 data source를 여러 view로 보여줄 수 있는 구조를 준비한다.
- Filter, sort, pagination은 서버 query로 처리한다.
- Cell/property/schema 변경은 transaction으로 정합성을 보장한다.
- 실시간 반영은 기존 Socket.IO/React Query 계층을 확장한다.
- Record 본문은 기존 Docmost page/editor 협업 모델을 재사용한다.

위 목표는 전체 target architecture 기준이다. Phase 1의 구체 범위는 `docs/implementation/database/phase-1/DESIGN.md`를 따른다.

### 비목표

초기 MVP에서는 다음을 제외한다.

- Relation
- Rollup
- Formula
- Board view
- Calendar view
- Timeline view
- Gallery view
- Form, chart, map
- Property별 보안 권한
- View별 독립 보안 권한
- Spreadsheet 수준의 undo/redo
- Offline-first database grid 편집

## 전체 구조

```text
Client
  features/database
    table view
    property editors
    view controls
    query/cache layer
    websocket event handler

Server
  core/databases
    data source service
    property schema service
    record service
    view service
    query service
    event service
    permission service

Postgres
  data_sources
  data_source_properties
  data_source_records
  data_source_property_values
  data_source_views
```

개념 모델은 다음과 같다.

```text
Page
  Database page 또는 Database block/linked view
    DataSource
      Properties schema
      Records
        Property values
      Views
        filter/sort/group/layout config
```

## 핵심 도메인 모델

### DataSource

DataSource는 실제 데이터 묶음이다.

예:

```text
Tasks
Projects
Customers
Candidates
```

DataSource는 record와 property schema를 소유한다. Database page나 inline database block은 data source를 보여주는 UI일 뿐이다.

### Property

Property는 column/schema다.

예:

```text
Title
Status
Assignee
Due date
Priority
Done
```

Property는 이름, 타입, 옵션, 정렬 순서, 타입별 설정을 가진다.

초기 지원 타입:

```text
title
text
number
select
multi_select
date
checkbox
person
url
email
phone
```

후속 타입:

```text
relation
rollup
formula
files
created_time
created_by
last_edited_time
last_edited_by
unique_id
button
```

### Record

Record는 database row/item이다.

Table view에서는 한 줄이고, board view에서는 카드이며, calendar view에서는 event가 될 수 있다.

구현상 record는 다음을 가진다.

```text
id
data_source_id
page_id nullable
created_by_id
created_at
updated_at
deleted_at
```

본문을 가진 record page는 기존 Docmost page/editor로 연결한다.

### PropertyValue

PropertyValue는 cell 값이다.

```text
record_id + property_id + value
```

사용자가 실제로 가장 자주 수정하는 데이터가 여기에 해당한다.

예:

```text
record: 로그인 버그 수정
property: Status
value: Doing
```

### View

View는 data source를 어떻게 보여줄지에 대한 설정이다. View는 데이터를 소유하지 않는다.

예:

```text
All tasks
My tasks
Sprint board
Due date calendar
```

View config 예:

```json
{
  "type": "table",
  "visibleProperties": ["title", "status", "assignee", "dueDate"],
  "propertyOrder": ["title", "status", "assignee", "dueDate"],
  "filter": {
    "operator": "and",
    "conditions": []
  },
  "sort": [
    {
      "propertyId": "dueDate",
      "direction": "asc"
    }
  ]
}
```

## Database Schema 초안

Docmost 서버는 Kysely/Postgres를 사용한다. 새 database 기능도 기존 마이그레이션 구조를 따른다.

### data_sources

```text
id
workspace_id
space_id
parent_page_id
name
description nullable
created_by_id
created_at
updated_at
deleted_at nullable
```

`parent_page_id`는 full-page database 또는 data source를 소유한 page와 연결하는 용도다.

### data_source_properties

```text
id
data_source_id
name
type
config_json
position
version
created_at
updated_at
deleted_at nullable
```

`config_json`에는 타입별 설정을 저장한다.

예:

```json
{
  "options": [
    { "id": "todo", "name": "Todo", "color": "gray" },
    { "id": "doing", "name": "Doing", "color": "blue" },
    { "id": "done", "name": "Done", "color": "green" }
  ]
}
```

### data_source_records

```text
id
data_source_id
page_id nullable
position nullable
created_by_id
created_at
updated_at
deleted_at nullable
```

`page_id`는 record를 page로 열 때 사용한다. 초기 row 생성 시에는 null일 수 있다.

### data_source_property_values

```text
id
data_source_id
record_id
property_id
value_json
text_value nullable
number_value nullable
date_value nullable
bool_value nullable
version
updated_by_id
updated_at
```

`value_json`은 원본 값을 저장한다. `text_value`, `number_value`, `date_value`, `bool_value`는 filter/sort 성능을 위한 보조 컬럼이다.

초기에 JSON만 쓰면 구현은 단순하지만, 서버 정렬/필터 성능이 빠르게 막힌다. 따라서 MVP부터 typed helper column을 둔다.

### data_source_views

```text
id
data_source_id
name
type
config_json
position
created_by_id
created_at
updated_at
deleted_at nullable
```

`type`은 초기에는 `table`만 지원한다. 이후 `board`, `calendar`, `gallery` 등을 추가한다.

## Record와 Page의 관계

Record는 처음부터 반드시 Docmost page를 만들지 않는다. 추천 방식은 lazy-create다.

```text
Record 생성
  data_source_records row 생성
  property values 생성
  page_id는 null 가능

Record를 page로 열기
  page_id가 없으면 내부 page 생성
  data_source_records.page_id 연결
  이후 본문은 기존 PageEditor 사용
```

이 방식의 장점:

- row가 많아져도 page tree가 오염되지 않는다.
- 본문이 없는 record를 가볍게 유지할 수 있다.
- record 5,000개 생성 시 page 5,000개를 즉시 만들 필요가 없다.
- 기존 page editor 협업 모델은 필요할 때만 사용한다.

권한은 초기에는 단순하게 둔다.

```text
DataSource 권한
  parent page 또는 space 권한 상속

Record 권한
  DataSource 권한 상속

Record body page 권한
  DataSource 권한 상속
```

Property별 보안 권한이나 view별 보안 권한은 만들지 않는다.

## Server Architecture

서버에는 새 도메인 모듈을 둔다. Phase 1의 확정 이름은 `core/databases`다.

```text
apps/server/src/core/databases/
  databases.module.ts
  databases.controller.ts
  dto/
    create-data-source.dto.ts
    update-data-source.dto.ts
    create-property.dto.ts
    update-property.dto.ts
    create-record.dto.ts
    update-property-value.dto.ts
    create-view.dto.ts
    update-view.dto.ts
    query-records.dto.ts
  services/
    data-source.service.ts
    property.service.ts
    record.service.ts
    view.service.ts
    query.service.ts
    database-event.service.ts
    database-permission.service.ts
```

주의할 점은 `apps/server/src/database`가 이미 infra/database 계층이라는 것이다. 그래서 Phase 1에서는 제품 도메인 모듈을 단수 `core/database`가 아니라 복수 `core/databases`로 둔다.

### API 그룹

```text
Data source API
  create/get/update/delete data source

Property API
  create/update/reorder/delete property

Record API
  create/update/delete record
  update property value

View API
  create/update/delete view
  query records by view
```

Phase 1 endpoint는 기존 Docmost controller 패턴에 맞춰 action-style POST route를 사용한다. 정확한 request/response contract는 `phase-1/DESIGN.md`를 따른다.

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

## Query Architecture

Database table을 열 때 클라이언트에 모든 row를 내려서 필터링하면 안 된다. QueryService가 view config를 읽고 서버에서 filter/sort/pagination을 실행한다.

```text
Client
  viewId + cursor 요청

Server QueryService
  data source 로드
  view config 로드
  permission 확인
  filter 적용
  sort 적용
  pagination 적용
  property values join
  row shape 반환
```

응답 예:

```json
{
  "records": [
    {
      "id": "record_1",
      "properties": {
        "title": {
          "value": "로그인 버그 수정",
          "version": 3
        },
        "status": {
          "value": "Doing",
          "version": 5
        }
      }
    }
  ],
  "nextCursor": "cursor"
}
```

초기 지원 query:

```text
filter
  text contains
  select equals
  multi_select contains
  date before/after
  checkbox equals
  person equals

sort
  text
  number
  date
  checkbox
  select option order
```

Relation, rollup, formula는 query engine 복잡도를 크게 올리므로 초기 범위에서 제외한다.

## Concurrency Architecture

Database grid/property는 Hocuspocus/Yjs가 아니라 Postgres transaction으로 동시성을 보장한다.

```text
정합성
  Postgres transaction
  property value version
  property schema version

실시간 반영
  Socket.IO event
  React Query invalidate/refetch

충돌 정책
  Phase 1은 last write wins
  version은 처음부터 저장
  이후 optimistic concurrency로 강화 가능
```

Cell update 흐름:

```text
Client A
  PATCH cell { value, baseVersion }

Server
  permission check
  property schema check
  value validation
  transaction
    update property value
    version + 1
  commit
  broadcast database.record.updated

Client B
  event 수신
  affected query invalidate/refetch
```

기본 정책:

```text
같은 cell 동시 수정
  마지막 write가 이김
  version 증가

서로 다른 cell 동시 수정
  둘 다 보존

삭제된 property에 cell update
  서버 reject

schema 변경 수신
  schema refetch
  view records refetch
```

나중에 더 엄격한 충돌 처리가 필요하면 `baseVersion`을 강제한다.

```sql
UPDATE data_source_property_values
SET value_json = $newValue,
    version = version + 1,
    updated_at = now(),
    updated_by_id = $userId
WHERE record_id = $recordId
  AND property_id = $propertyId
  AND version = $baseVersion;
```

영향 받은 row가 0이면 `409 Conflict`를 반환한다.

## Event Architecture

기존 Docmost websocket 계층을 확장한다.

초기 event:

```text
database.record.created
database.record.updated
database.record.deleted
database.property.created
database.property.updated
database.property.deleted
database.view.created
database.view.updated
database.view.deleted
database.data_source.updated
```

초기 클라이언트 반응:

```text
record.updated
  해당 data source/view records invalidate

property.updated/deleted
  properties invalidate
  visible views invalidate
  records invalidate

view.updated
  view config invalidate
  records invalidate
```

처음에는 cache patch보다 refetch를 우선한다. 구현 안정성이 더 중요하다. 성능 병목이 확인되면 event payload를 키워서 targeted cache patch로 최적화한다.

## Client Architecture

클라이언트는 새 feature로 분리한다.

```text
apps/client/src/features/database/
  types/
    database.types.ts
  services/
    database-service.ts
  queries/
    database-query.ts
  hooks/
    use-database-events.ts
    use-update-property-value.ts
  components/
    database-page.tsx
    database-table.tsx
    database-toolbar.tsx
    view-tabs.tsx
    property-header.tsx
    cell-renderers/
    cell-editors/
```

React Query key:

```text
['data-source', dataSourceId]
['data-source-properties', dataSourceId]
['data-source-views', dataSourceId]
['data-source-view-records', dataSourceId, viewId, queryState]
```

초기 UI는 full-page database를 먼저 만든다.

```text
DatabasePage
  Header
    title
    view tabs
    new record button

  Toolbar
    filter
    sort
    property visibility

  DatabaseTable
    header row
    body rows
    add row
    add property
```

Inline database block은 Phase 5에서 붙인다. 이때 full-page database의 table component를 재사용하고, editor block은 `dataSourceId`, `viewId`만 들고 있는 shell로 만든다.

## Phase Plan

### Phase 0: Spec / Spike

목표:

- 데이터 모델 확정
- record-page 관계 확정
- API contract 확정
- event schema 확정
- 성능 기준 확정

산출물:

- architecture doc
- migration draft
- API schema
- event schema

예상: 3-5일

### Phase 1: Server Foundation

목표:

- DataSource CRUD
- Property CRUD
- Record CRUD
- Property value update
- View CRUD
- Table query API
- Permission check
- Migration
- Kysely type generation

제외:

- 실시간 event
- 고급 UI
- relation/formula
- inline block

예상: 1.5-2.5주

### Phase 2: Minimal Table UI

목표:

- Full-page database 화면
- Table view 렌더링
- Row 추가/삭제
- Column 추가/삭제
- Cell edit
- 기본 filter/sort
- Pagination

예상: 2-3주

### Phase 3: Realtime + Concurrency

목표:

- public optimistic concurrency/baseVersion enforcement 적용
- transaction 정책 확정
- database websocket event 추가
- React Query invalidate/refetch 연결
- 동시 수정 테스트
- schema 변경 중 cell update 테스트

예상: 1-1.5주

### Phase 4: Product Hardening

목표:

- 권한 edge case 정리
- 성능 인덱스 보강
- empty/loading/error state
- keyboard navigation 일부
- validation error UX
- e2e 테스트

제외 또는 제한:

- 복잡한 undo/redo
- offline-first grid editing

예상: 1.5-2주

### Phase 5: Inline Database Block

목표:

- Editor 안에 database view 삽입
- full-page table component 재사용
- block attrs에 `dataSourceId`, `viewId` 저장
- linked view UX 시작

예상: 1.5-2.5주

### Phase 6: Extended Views and Advanced Properties

추천 순서:

```text
Board view
Calendar view
Gallery/List view
Relation
Rollup
Formula
```

이 단계부터는 MVP 이후 별도 프로젝트로 보는 것이 적절하다.

## 구현 순서 추천

실제 개발은 다음 순서가 가장 안정적이다.

```text
1. Migration + Kysely type
2. DataSource/Property/Record/View service
3. QueryService
4. Full-page route
5. Minimal table render
6. Cell update
7. Filter/sort/pagination
8. Websocket event
9. 동시성 테스트
10. Inline block
```

처음부터 inline database block을 만들지 않는다. 에디터 extension과 얽히면 서버 모델과 query layer 검증이 늦어진다.

## 주요 설계 결정

| 결정 | 선택 |
| --- | --- |
| 동시성 방식 | 서버 transaction + websocket event |
| 초기 UI | Full-page database |
| 초기 view | Table only |
| record page 생성 | Lazy-create |
| property value 저장 | JSON + typed helper columns |
| same-cell conflict | Last write wins |
| version column | 처음부터 추가 |
| event 수신 | 초기에는 refetch |
| 권한 | parent page/space 권한 상속 |
| relation/rollup/formula | MVP 이후 |

## 결정된 쟁점과 후속 쟁점

### 1. 도메인 이름

Phase 1에서는 `core/databases`로 결정한다. `apps/server/src/database`는 DB infra 계층이므로 제품 도메인 모듈을 단수 `core/database`로 두지 않는다.

### 2. Full-page database를 page type으로 볼지

Phase 1 기준 결정:

```text
기존 pages row가 data_sources row 하나를 소유한다.
data_sources.parent_page_id는 장기적으로도 data source의 소유 page다.
```

후속 phase에서 이 page를 database page처럼 렌더링하는 UI/page type 표현은 별도 설계로 확정한다. 별도 container table은 만들지 않는다.

### 3. Record ordering

Phase 1 기준 결정:

```text
position varchar
fractional-indexing-jittered 사용
sort가 없으면 position asc, id asc
수동 reorder는 update position으로만 지원
```

### 4. Select option 삭제 정책

Phase 1 기준 결정:

```text
option은 archived 처리
기존 값은 깨지지 않게 표시
새 선택에서는 제외
sort/filter는 stable option id와 sortKey 기준
```

### 5. Import/export

Database 기능이 생기면 export/import 모델도 확장해야 한다. MVP에서는 제외하되, schema 설계 시 workspace/space ownership은 명확히 둔다.

## 전체 견적

```text
Phase 0-4
  6-9주 / 1명 풀타임

Phase 5 inline block 포함
  8-12주 / 1명 풀타임

Board/Calendar 포함
  12-18주+

Relation/Rollup/Formula 포함
  별도 대형 단계
```

1차 구현 목표는 Phase 0-4로 잡는 것이 적절하다.

1차 완료 기준:

```text
Docmost에 full-page database를 만들 수 있다.
Property schema를 편집할 수 있다.
Record/cell을 편집할 수 있다.
Filter/sort/pagination이 서버에서 실행된다.
동시 수정은 transaction/version/event로 깨지지 않는다.
```
