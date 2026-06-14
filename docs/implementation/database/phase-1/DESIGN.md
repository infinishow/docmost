# Database Phase 1 Design

작성일: 2026-06-11

이 문서는 Docmost에 Notion식 Database 기능을 추가하기 위한 Phase 1 server foundation 설계 계약이다. Phase 1은 사용자 화면을 만들지 않고, 후속 phase에서 table UI와 full-page database를 얹을 수 있는 서버 모델과 API를 먼저 만든다.

관련 문서:

- `docs/implementation/database/ARCHITECTURE.md`
- `docs/implementation/database/phase-1/MODEL_EXPLAINED.md`
- `docs/implementation/database/phase-1/REVIEW_NOTES.md`
- `docs/research/NOTION_DATABASE_RESEARCH.md`
- `docs/research/CONCURRENCY_RESEARCH.md`

## 1. 결론

Phase 1은 다음을 구현한다.

```text
기존 Docmost Page
  └─ DataSource
       ├─ Properties
       ├─ Records
       ├─ PropertyValues
       └─ Views
```

Phase 1에서 `databaseId`라고 부르는 값은 실제로 `data_sources.id`다. Phase 1에는 database block id, linked database container id가 없다.

후속 full-page database도 별도 container table을 만들지 않고 기존 `pages` row가 `data_sources` row 하나를 소유하는 방식으로 확장한다. 따라서 Phase 1의 `parent_page_id`는 "임시 포함 page"가 아니라 장기적으로도 data source의 소유 page다. Phase 2에서 full-page database UI를 만들 때는 기존 page를 database page처럼 렌더링하되, 이 page의 본문 block 모델과 data source 연결 방식은 별도 설계로 확정한다.

사용자-facing API route는 `/databases/*`를 사용하되, 내부 모델명은 `DataSource`를 유지한다.

## 2. Scope

### 포함

- 서버 migration
- Kysely generated type 반영
- DataSource CRUD
- Property CRUD
- Record CRUD
- PropertyValue update
- View CRUD
- View 기반 record query API
- Parent page 기반 read/write 권한 검사
- DDL constraint와 index
- 서버 단위 테스트

### 제외

- Client UI
- Table 화면
- Cell editor
- Full-page database page type
- Inline database block
- Linked database block
- Record page 본문 생성
- Websocket event 전파
- Optimistic UI
- CRDT 기반 database grid 편집
- Relation
- Rollup
- Formula
- Board/calendar/gallery view
- Search indexing
- Notification
- Watcher
- Activity feed
- Audit event

## 3. Phase 1과 전체 아키텍처의 관계

전체 목표는 Notion식 database 기능과 기능적으로 동질적인 구조를 Docmost 위에 구현하는 것이다. 즉 같은 원본 데이터 묶음을 table, board, calendar, linked database 등으로 재사용할 수 있어야 한다.

Phase 1은 이 목표 중 서버 원본 데이터 구조만 만든다.

```text
Target architecture
  Full-page database
  Table view
  Record page body
  Realtime event
  Inline/linked database
  Advanced properties

Phase 1 contract
  DataSource server model
  CRUD/query API
  Parent page permission
  Transactional persistence
```

따라서 Phase 1 결과물만으로는 Notion database 사용자 기능과 동질하지 않다. 하지만 Phase 1의 building block은 그 동질성을 달성하기 위한 기반으로 고정한다.

## 4. Module Structure

제품 도메인 모듈은 `core/databases`를 사용한다. `apps/server/src/database`는 DB infra 영역으로 이미 존재하므로, 제품 기능 모듈 이름을 `core/database`로 두지 않는다.

```text
apps/server/src/core/databases/
  databases.module.ts
  databases.controller.ts
  dto/
    data-source.dto.ts
    property.dto.ts
    record.dto.ts
    property-value.dto.ts
    view.dto.ts
    query.dto.ts
  services/
    data-source.service.ts
    property.service.ts
    record.service.ts
    property-value.service.ts
    view.service.ts
    query.service.ts
    database-permission.service.ts
```

Persistence 계층은 실제 모델명에 맞춰 `data-source` repo 디렉터리를 둔다.

```text
apps/server/src/database/repos/data-source/
  data-source.repo.ts
  data-source-property.repo.ts
  data-source-record.repo.ts
  data-source-property-value.repo.ts
  data-source-view.repo.ts
```

`CoreModule`은 `DatabasesModule`을 import한다.

## 5. Responsibility Boundaries

### Controller

- `JwtAuthGuard` 적용
- `@AuthUser()`와 `@AuthWorkspace()` 추출
- DTO validation
- HTTP action route 제공
- 직접 SQL 실행 금지
- 권한 판단 직접 구현 금지

### Service

- 유스케이스 orchestration
- 권한 검사 호출
- transaction 경계 관리
- 기본 title property와 기본 table view 생성
- property type별 value validation/normalization 호출
- repo 호출 결과를 API response로 조립

### Repo

- Kysely SQL
- insert/update/select/delete
- cursor pagination query
- filter/sort query building
- transaction object 수용
- HTTP 예외나 request context를 알지 않음

### DatabasePermissionService

- DataSource 또는 parent page를 기준으로 permission check 수행
- read는 `PageAccessService.validateCanView`
- write는 `PageAccessService.validateCanEdit`
- parent page가 없거나 deleted이면 NotFound 처리
- workspace/space consistency 검증

## 6. Data Model

### data_sources

실제 데이터 묶음이다.

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

규칙:

- `parent_page_id`는 `pages.id`를 참조한다.
- parent page가 영구 삭제되면 data source도 cascade 삭제된다.
- `workspace_id`와 `space_id`는 생성 시 parent page 값으로 채운다.
- 모든 조회/수정 시 parent page의 workspace/space와 일치하는지 검증한다.
- Phase 1에서는 data source를 다른 parent page로 이동하는 API를 만들지 않는다.

### data_source_properties

컬럼 schema다.

```text
id
data_source_id
name
type
config_json
position
version
created_by_id
created_at
updated_at
deleted_at nullable
```

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

규칙:

- data source마다 `title` property는 정확히 하나다.
- Phase 1은 `title` property 삭제를 허용하지 않는다.
- property 삭제는 soft delete다.
- property type 변경은 Phase 1에서 허용하지 않는다.
- `position`으로 column order를 저장한다.

### data_source_records

Database row다.

```text
id
data_source_id
page_id nullable
position
version
created_by_id
created_at
updated_at
deleted_at nullable
```

규칙:

- Phase 1 record는 structured row only다.
- `page_id`는 nullable이며 Phase 1에서 생성하지 않는다.
- record page 본문, URL, page permission, comments, backlinks, watchers, history는 Phase 1 범위가 아니다.
- record 삭제는 soft delete다.

### data_source_property_values

Cell 값이다.

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
created_by_id
last_edited_by_id
created_at
updated_at
deleted_at nullable
```

규칙:

- `(record_id, property_id)`는 unique다.
- `data_source_id`는 record/property가 같은 data source에 속하는지 DB와 service 양쪽에서 검증하기 위해 저장한다.
- `value_json`이 canonical source다.
- helper column은 filter/sort/search 준비용이다.
- Phase 1에서 같은 cell 동시 수정은 last-write-wins다.

### data_source_views

같은 data source를 어떻게 보여줄지에 대한 설정이다.

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

규칙:

- Phase 1에서 view `type`은 `table`만 지원한다.
- view는 데이터를 소유하지 않는다.
- filter/sort/visible properties/order는 `config_json`에 저장한다.

### Position fields

`data_source_properties.position`, `data_source_records.position`, `data_source_views.position`은 기존 `pages.position`과 같은 방식으로 `varchar`에 fractional indexing key를 저장한다.

규칙:

- 새 row의 `position`이 없으면 같은 parent scope의 마지막 position 뒤에 `generateJitteredKeyBetween(lastPosition, null)`로 append한다.
- 최초 row는 `generateJitteredKeyBetween(null, null)`을 사용한다.
- 클라이언트가 position을 넘기면 서버가 `generateJitteredKeyBetween(position, null)` 호출로 유효성을 검증한다. 기존 page move 검증과 같은 패턴이다.
- order query는 `position COLLATE "C" asc`, tie-breaker는 `id asc`다.
- Phase 1에는 between reorder API를 별도로 만들지 않는다. `update` API의 `position` 변경만 지원한다.

## 7. DDL Constraints and Indexes

### Constraints

```text
data_sources.parent_page_id -> pages.id on delete cascade
data_sources.workspace_id -> workspaces.id on delete cascade
data_sources.space_id -> spaces.id on delete cascade
data_sources.created_by_id -> users.id

data_source_properties.data_source_id -> data_sources.id on delete cascade
data_source_properties.created_by_id -> users.id

data_source_records.data_source_id -> data_sources.id on delete cascade
data_source_records.page_id -> pages.id nullable on delete set null
data_source_records.created_by_id -> users.id
unique(data_source_records.id, data_source_records.data_source_id)

data_source_property_values.data_source_id -> data_sources.id on delete cascade
data_source_property_values.record_id -> data_source_records.id on delete cascade
data_source_property_values.property_id -> data_source_properties.id on delete cascade
data_source_property_values.created_by_id -> users.id
data_source_property_values.last_edited_by_id -> users.id
unique(data_source_property_values.record_id, data_source_property_values.property_id)

data_source_views.data_source_id -> data_sources.id on delete cascade
data_source_views.created_by_id -> users.id
```

Cross data source guard:

```text
unique(data_source_properties.id, data_source_properties.data_source_id)
foreign key (data_source_property_values.record_id, data_source_property_values.data_source_id)
  -> data_source_records(id, data_source_id)
foreign key (data_source_property_values.property_id, data_source_property_values.data_source_id)
  -> data_source_properties(id, data_source_id)
```

이 composite FK가 migration에서 과도하게 복잡해지면 implementation plan에서 DB-level constraint와 service-level validation의 실제 조합을 다시 검토할 수 있다. 단, Phase 1 완료 조건은 cross-data-source value write가 DB/repo/service 테스트 중 최소 한 계층에서 반드시 거부되는 것이다.

Title property uniqueness:

```text
한 data source 안에서 deleted_at is null인 title property는 하나만 허용한다.
```

Postgres partial unique index로 구현한다.

### Indexes

```text
data_sources(parent_page_id)
data_sources(workspace_id, space_id)
data_sources(deleted_at)

data_source_properties(data_source_id, position)
data_source_properties(data_source_id, deleted_at)

data_source_records(data_source_id, position)
data_source_records(data_source_id, deleted_at)

data_source_property_values(record_id)
data_source_property_values(data_source_id)
data_source_property_values(property_id)
data_source_property_values(property_id, text_value)
data_source_property_values(property_id, number_value)
data_source_property_values(property_id, date_value)
data_source_property_values(property_id, bool_value)

data_source_views(data_source_id, position)
data_source_views(data_source_id, deleted_at)
```

Helper column indexes는 Phase 1 query 범위를 과도하게 키우면 쓰기 비용이 늘 수 있다. 구현 중 최소 index set으로 조정할 수 있지만, `(record_id, property_id)` unique와 data source order indexes는 필수다.

## 8. Lifecycle Contract

### Common active-row rule

모든 read/query/update/delete API는 다음 active 조건을 만족하는 row만 대상으로 한다.

```text
data_sources.deleted_at is null
parent pages.deleted_at is null
properties.deleted_at is null
records.deleted_at is null
views.deleted_at is null
property_values.deleted_at is null
```

ID가 존재하더라도 active 조건을 만족하지 않으면 외부 API에서는 `NotFoundException`으로 처리한다.

### Lifecycle matrix

```text
DataSource
  create:
    data source, default title property, default table view를 같은 transaction에서 생성
  read/query/update:
    data source와 parent page가 active일 때만 허용
  delete:
    data_sources.deleted_at만 soft delete
    child rows는 즉시 soft delete하지 않음
    모든 child API는 active data source 조건 때문에 NotFound
  restore:
    Phase 1 public API 없음
    추후 restore가 필요하면 data_sources.deleted_at을 null로 되돌리면 child rows는 유지된 상태로 재노출 가능
  permanent delete:
    hard delete 시 FK cascade로 child rows 삭제

Property
  create:
    active data source 안에 생성
  update:
    name, config, position만 허용
    type 변경은 BadRequest
  delete:
    title property는 BadRequest
    property와 해당 property values를 같은 transaction에서 soft delete
  restore:
    Phase 1 public API 없음
  permanent delete:
    hard delete 시 FK cascade로 property values 삭제

Record
  create:
    active data source 안에 structured row 생성
  update:
    position만 수정
  delete:
    record와 해당 property values를 같은 transaction에서 soft delete
  restore:
    Phase 1 public API 없음
  permanent delete:
    hard delete 시 FK cascade로 property values 삭제

PropertyValue
  create/update:
    active data source, record, property에 대해서만 upsert
  delete:
    별도 public delete API 없음
    null value update는 cell을 빈 값으로 저장하고 row는 유지
  restore:
    Phase 1 public API 없음
  permanent delete:
    parent record/property hard delete 시 cascade

View
  create/update:
    active data source 안에서 table view만 허용
  delete:
    view soft delete
    마지막 active view 삭제는 BadRequest
  restore:
    Phase 1 public API 없음
  permanent delete:
    data source hard delete 시 cascade
```

### Parent page soft delete

Parent page의 `deletedAt`이 null이 아니면 해당 data source는 없는 것으로 취급한다.

```text
read API -> NotFound
write API -> NotFound
query API -> NotFound
```

DataSource row 자체를 즉시 soft delete하지 않는다. parent page 복구 시 다시 접근 가능해야 하기 때문이다.

### Parent page restore

Parent page가 복구되면 data source도 다시 접근 가능하다.

### Parent page permanent delete

Parent page가 DB에서 삭제되면 FK cascade로 data source와 하위 rows가 삭제된다.

### Parent page move to another space

Phase 1은 page move와 data source `space_id` 동기화를 구현한다. 기존 `PageService.movePageToSpace` 흐름에서 이동되는 page id 집합을 알 수 있으므로, 같은 transaction 안에서 `parent_page_id in movedPageIds`인 active/inactive data source의 `space_id`를 destination space로 갱신한다.

workspace는 page move로 바뀌지 않는 것으로 본다. 만약 parent page와 data source의 `workspace_id`, `space_id` 불일치가 발견되면 외부 API에서는 존재 여부 노출을 줄이기 위해 `NotFoundException`으로 처리하고, 서버 log에는 integrity error로 남긴다.

### Duplicate

Phase 1에서 page duplicate는 data source를 복제하지 않는다. Duplicate integration은 Phase 2 이후에 정의한다.

### Share/export/sidebar/search

Phase 1에서 share/export/sidebar/search 통합은 하지 않는다.

## 9. Permission Semantics

Phase 1은 database 전용 권한 모델을 만들지 않는다. 모든 database 권한은 parent page 기준이다.

권한 종류는 나중에 세분화할 수 있도록 개념적으로 나눈다. Phase 1 구현은 모두 기존 page 권한으로 매핑한다.

```text
readData
  records/query, databases/info
  PageAccessService.validateCanView

writeData
  record create/update/delete, value update
  PageAccessService.validateCanEdit

writeSchema
  property create/update/delete, data source update/delete
  PageAccessService.validateCanEdit

writeView
  view create/update/delete
  PageAccessService.validateCanEdit
```

`/databases/info` 응답에는 다음 capability flags를 포함한다.

```text
capabilities:
  canReadData
  canWriteData
  canWriteSchema
  canWriteView
```

Phase 1에서는 `canWriteData`, `canWriteSchema`, `canWriteView`가 모두 같은 edit permission 결과를 사용한다. 이 구조를 두는 이유는 후속 phase에서 Notion식 database permission을 세분화해도 API shape을 크게 바꾸지 않기 위해서다.

### Read

```text
1. DataSource를 로드한다.
2. parent page를 로드한다.
3. parent page가 없거나 deletedAt이 있으면 NotFoundException.
4. data source workspace/space가 parent page와 다르면 NotFoundException.
5. PageAccessService.validateCanView(parentPage, user)를 호출한다.
```

### Write

```text
1. DataSource를 로드한다.
2. parent page를 로드한다.
3. parent page가 없거나 deletedAt이 있으면 NotFoundException.
4. data source workspace/space가 parent page와 다르면 NotFoundException.
5. PageAccessService.validateCanEdit(parentPage, user)를 호출한다.
```

### Create DataSource

```text
1. parent page를 로드한다.
2. parent page가 없거나 deletedAt이 있으면 NotFoundException.
3. parent page workspace가 AuthWorkspace와 다르면 NotFoundException.
4. PageAccessService.validateCanEdit(parentPage, user)를 호출한다.
5. parent page의 workspaceId/spaceId로 data source를 생성한다.
```

### Deferred permission features

Phase 1에서는 다음을 만들지 않는다.

```text
record별 permission
property별 permission
view별 permission
database 전용 permission
public share permission
```

## 10. API Contract

모든 endpoint는 `JwtAuthGuard`를 사용하고 기존 Docmost core controller 패턴에 맞춰 action-style POST route를 사용한다.

### DataSource

```text
POST /databases/create
  body:
    parentPageId
    name
    description?
  returns:
    database
    defaultView
    properties
    capabilities

POST /databases/info
  body:
    databaseId
  returns:
    database
    properties
    views
    capabilities

POST /databases/update
  body:
    databaseId
    name?
    description?
  returns:
    database

POST /databases/delete
  body:
    databaseId
  returns:
    void
```

`databaseId`는 `data_sources.id`다.

Response shape:

```text
database:
  id
  parentPageId
  workspaceId
  spaceId
  name
  description
  createdById
  createdAt
  updatedAt

capabilities:
  canReadData
  canWriteData
  canWriteSchema
  canWriteView
```

### Properties

```text
POST /databases/properties/create
  body:
    databaseId
    name
    type
    config?
    position?
  returns:
    property

POST /databases/properties/update
  body:
    propertyId
    name?
    config?
    position?
  returns:
    property

POST /databases/properties/delete
  body:
    propertyId
  returns:
    void
```

규칙:

- `title` property 생성은 DataSource create flow에서만 수행한다.
- `title` property 삭제는 BadRequest.
- property type update는 BadRequest.
- property response는 `id`, `databaseId`, `name`, `type`, `config`, `position`, `version`, `createdAt`, `updatedAt`을 포함한다.

### Records

```text
POST /databases/records/create
  body:
    databaseId
    position?
    values?
  returns:
    record
    values

POST /databases/records/update
  body:
    recordId
    position?
  returns:
    record

POST /databases/records/delete
  body:
    recordId
  returns:
    void

POST /databases/records/query
  body:
    databaseId
    viewId?
    cursor?
    limit?
    filter?
    sort?
  returns:
    records
    nextCursor
    hasNextPage
```

`records/query`는 Phase 1에서 parent data source permission만 확인한다. record별 permission filtering은 없다.

Query response shape:

```text
record:
  id
  databaseId
  pageId
  position
  version
  createdById
  createdAt
  updatedAt
  values:
    [propertyId]:
      id
      propertyId
      value
      version
      updatedAt
```

`limit` 기본값은 50, 최대값은 100이다. cursor는 기존 cursor pagination helper 형식을 따른다.

### Property Values

```text
POST /databases/values/update
  body:
    recordId
    propertyId
    value
  returns:
    propertyValue
```

Phase 1 DTO에는 `baseVersion`을 넣지 않는다. Version은 서버 내부 추적 값이며 409 conflict API는 Phase 3 이후에 설계한다.

### Views

```text
POST /databases/views/create
  body:
    databaseId
    name
    type
    config?
    position?
  returns:
    view

POST /databases/views/update
  body:
    viewId
    name?
    config?
    position?
  returns:
    view

POST /databases/views/delete
  body:
    viewId
  returns:
    void
```

Phase 1에서 `type`은 `table`만 허용한다.

View response는 `id`, `databaseId`, `name`, `type`, `config`, `position`, `createdAt`, `updatedAt`을 포함한다.

## 11. Transaction Flows

### Create DataSource

Transaction 안에서 다음을 만든다.

```text
1. data_sources row
2. default title property
3. default table view
```

실패하면 모두 rollback한다.

### Delete DataSource

Transaction 안에서 다음을 처리한다.

```text
1. data source 로드
2. parent page write permission 확인
3. data_sources.deleted_at 설정
```

Child rows는 soft delete하지 않는다. 모든 child API는 active data source 조건을 먼저 확인하므로 삭제된 data source 아래의 property/record/value/view는 외부에서 보이지 않는다.

### Create Record

Transaction 안에서 다음을 처리한다.

```text
1. data_source_records row 생성
2. values가 있으면 property별 validation
3. data_source_property_values upsert
4. record version 증가
```

### Update PropertyValue

Transaction 안에서 다음을 처리한다.

```text
1. record 로드
2. property 로드
3. record와 property가 같은 data source인지 확인
4. data source write permission 확인
5. type별 value validation/normalization
6. property value upsert
7. property value version 증가
8. record version 증가
```

### Delete Property

Property는 soft delete한다. 연결된 property values도 soft delete할 수 있다.

권장 구현:

```text
1. property soft delete
2. 해당 property values soft delete
```

`title` property는 삭제할 수 없다.

### Delete Record

Record는 soft delete한다. 연결된 property values도 soft delete한다.

## 12. Property Value Normalization

`value_json`은 canonical source다. Helper column은 filter/sort/query를 위한 파생 값이다.

### 지원 규칙

```text
title/text/url/email/phone
  value_json = string 또는 null
  text_value = normalized string 또는 null

number
  value_json = number 또는 null
  number_value = number 또는 null

checkbox
  value_json = boolean 또는 null
  bool_value = boolean 또는 null

date
  value_json = { start, end?, timeZone? } 또는 null
  date_value = start timestamp 또는 null

select
  value_json = option id 또는 null
  text_value = option sortKey 또는 null

multi_select
  value_json = option id 배열
  helper column은 Phase 1 query에 사용하지 않음

person
  value_json = user id 배열
  helper column은 Phase 1 query에 사용하지 않음
```

### Validation

- 지원하지 않는 property type은 BadRequest.
- property type과 맞지 않는 value는 BadRequest.
- select/multi_select option은 property `config_json.options`에 존재해야 한다.
- select option config는 `id`, `name`, `color?`, `sortKey`, `archived?`를 가진다.
- select option rename은 cell의 `value_json`을 바꾸지 않는다.
- select option delete는 Phase 1에서 hard delete하지 않고 `archived: true`로 표시한다. archived option은 기존 cell 표시와 filter/sort에는 남지만 새 값 선택에는 사용할 수 없다.
- person user id는 같은 workspace의 user인지 확인한다.
- email/url/phone은 Phase 1에서 엄격한 외부 검증보다 string normalization만 수행한다.

## 13. Query, Filter, Sort

Phase 1 query는 서버에서 실행한다. Client가 모든 record를 내려받아 filter/sort하지 않는다.

### Pagination

기존 `PaginationOptions`와 cursor pagination helper를 따른다.

기본 정렬:

```text
data_source_records.position asc
data_source_records.id asc
```

`viewId`가 있으면 view의 `config_json.filter`, `config_json.sort`, `config_json.visiblePropertyIds`를 기본 query config로 사용한다. Request body에 `filter`가 있으면 view filter와 `AND`로 결합한다. Request body에 `sort`가 있으면 view sort를 대체한다. 이 규칙은 Phase 1 table UI가 임시 filter를 쉽게 얹을 수 있게 하면서도 sort cursor 안정성을 단순하게 유지하기 위한 것이다.

### Filter 지원

Phase 1에서 filter는 제한적으로 지원한다.

```text
title/text/url/email/phone
  equals
  contains
  is_empty
  is_not_empty

number
  equals
  greater_than
  less_than
  is_empty
  is_not_empty

checkbox
  equals

date
  equals
  before
  after
  is_empty
  is_not_empty

select
  equals
  is_empty
  is_not_empty
```

Phase 1에서 `multi_select`와 `person` filter/sort는 BadRequest로 거부한다.

Filter AST:

```text
filter:
  { "and": [filter, ...] }
  { "or": [filter, ...] }
  {
    "propertyId": string,
    "operator": string,
    "value"?: unknown
  }
```

규칙:

- `and`/`or`는 최대 depth 3까지 허용한다.
- 한 request의 leaf filter는 최대 20개까지 허용한다.
- `propertyId`가 없거나 active property가 아니면 BadRequest.
- filter 대상 property가 요청한 database에 속하지 않으면 BadRequest.
- 지원하지 않는 operator/type 조합은 BadRequest.
- text 계열 `contains`는 case-insensitive로 처리한다.
- text 계열 `equals`는 Phase 1에서 case-sensitive로 처리한다.
- `is_empty`는 value row가 없거나 canonical value가 null/empty string인 경우를 포함한다.
- `is_not_empty`는 canonical value가 null/empty string이 아닌 경우다.
- date `equals`는 `value_json.start`가 같은 calendar date 범위에 들어오는지로 처리한다. timezone이 있으면 해당 timezone 기준, 없으면 UTC 기준이다.
- date `before`/`after`는 `date_value` timestamp 비교다.

### Sort 지원

Phase 1 sort는 helper column이 있는 타입만 지원한다.

```text
title/text/url/email/phone -> text_value
number -> number_value
checkbox -> bool_value
date -> date_value
select -> text_value
```

지원하지 않는 property type sort는 BadRequest.

Sort shape:

```text
sort:
  [
    { "propertyId": string, "direction": "asc" | "desc" }
  ]
```

규칙:

- sort 항목은 최대 3개까지 허용한다.
- 모든 sort 뒤에는 cursor 안정성을 위해 `data_source_records.position asc`, `data_source_records.id asc`를 tie-breaker로 붙인다.
- null helper value는 `asc`에서 마지막, `desc`에서도 마지막에 둔다.
- select sort는 option label이 아니라 option의 stable `sortKey`를 사용한다.

## 14. Version and Concurrency

Phase 1은 server API + Postgres transaction 방식이다. Database grid를 Yjs 문서로 만들지 않는다.

```text
Same cell concurrent write
  last-write-wins

Different cell concurrent write
  독립 update

Schema deletion conflict
  삭제된 property/record에 대한 write는 NotFound 또는 BadRequest
```

Version column은 저장하지만, Phase 1 public API는 optimistic concurrency를 제공하지 않는다.

```text
baseVersion DTO 없음
409 conflict 없음
version은 응답과 내부 추적용
```

Phase 3에서 websocket event와 optimistic conflict 처리를 붙일 수 있다.

## 15. Error Handling

```text
NotFoundException
  data source 없음
  parent page 없음
  parent page deleted
  data source workspace/space가 parent page와 불일치
  record 없음
  property 없음
  view 없음

ForbiddenException
  parent page read/edit 권한 없음

BadRequestException
  지원하지 않는 property type
  잘못된 value shape
  property와 record가 다른 data source
  title property 삭제 시도
  property type 변경 시도
  지원하지 않는 filter/sort
```

Internal integrity mismatch는 서버 log에 남기되, 외부 응답은 `NotFoundException`으로 낮춘다.

## 16. Deferred Integrations

Phase 1에서 다음 integration은 명시적으로 하지 않는다.

```text
Search
  data source name, property name, record title value indexing 없음

Audit
  database create/update/delete audit event 없음

Notification
  database 변경 알림 없음

Watcher
  database watch 없음

Websocket
  database mutation event broadcast 없음

Sidebar
  database entry 표시 없음

Share/export
  database share/export 없음
```

후속 phase에서 사용자가 볼 수 있는 UI를 만들 때 이 integration들을 다시 설계한다.

## 17. Testing Strategy

Phase 1 테스트는 service 단위 테스트와 DB/repo integration 테스트를 함께 작성한다. 권한, soft delete, cross-workspace leakage, query SQL은 unit mock만으로 완료 처리하지 않는다.

### Service tests

```text
DataSourceService
  parent page 권한 검증 후 data source 생성
  기본 title property 생성
  기본 table view 생성
  parent page deleted 시 NotFound

PropertyService
  property 생성/수정/삭제
  title property 삭제 거부
  type 변경 거부

RecordService
  record 생성/삭제
  initial values validation

PropertyValueService
  타입별 value normalization
  record/property data source mismatch 거부
  upsert와 version 증가

QueryService
  기본 pagination
  지원 타입 filter/sort
  미지원 filter/sort 거부

DatabasePermissionService
  validateCanView/validateCanEdit 호출 경로
  parent page deleted 처리
  workspace/space mismatch 처리
```

### Integration/repo tests

다음은 Phase 1 필수 검증이다.

```text
Migration
  migration up/down
  5개 table 생성
  FK/unique/partial unique index 동작

Permission and leakage
  권한 없는 user가 databaseId로 info/query/update 불가
  권한 없는 user가 recordId/propertyId/valueId 직접 지정해도 불가
  다른 workspace/space id 조합으로 접근 불가

Lifecycle
  data source soft delete 후 info/query/child update NotFound
  parent page soft delete 후 info/query/update NotFound
  parent page restore 후 data source 접근 가능
  page move-to-space 후 data_sources.space_id 동기화

Soft delete filtering
  deleted property/record/view/value가 query에 노출되지 않음

Query
  기본 pagination order
  view filter와 request filter AND 결합
  request sort가 view sort 대체
  null ordering
  text contains case-insensitive
  date equals timezone 처리

Integrity
unique(record_id, property_id)
title property partial unique
record/property cross data source value write 거부
```

### Migration verification

구현 완료 시 최소 검증:

```text
pnpm --filter server migration:up
pnpm --filter server migration:down
pnpm --filter server test
pnpm --filter server build
```

실제 명령은 repo의 package manager 구성과 local DB 준비 상태에 맞춰 implementation plan에서 확정한다.

## 18. Acceptance Criteria

Phase 1은 다음 조건을 만족하면 완료로 본다.

```text
1. Migration으로 5개 data source 관련 테이블이 생성된다.
2. Kysely generated type이 새 테이블을 포함한다.
3. /databases/* action-style POST API가 compile된다.
4. DataSource 생성 시 parent page 권한이 검증된다.
5. DataSource 생성 시 title property와 table view가 transaction으로 함께 생성된다.
6. Property/record/value/view CRUD가 parent page 권한을 따른다.
7. Property value는 타입별로 value_json과 helper column에 normalized 저장된다.
8. Record query는 서버 pagination/filter/sort를 사용한다.
9. DataSource soft delete와 parent page soft delete/move lifecycle이 테스트된다.
10. record/property cross data source value write가 거부된다.
11. Phase 1에서 제외한 UI/event/search/audit 기능이 구현되지 않았음이 문서에 명확하다.
12. 서버 테스트와 build 검증이 통과한다.
```

## 19. Implementation Defaults

Phase 1 implementation plan은 다음 기본 결정을 따른다.

```text
1. Parent page move-to-space 동기화는 Phase 1에서 구현.
2. Helper column index는 Phase 1 query 지원 타입 중심으로 최소화.
3. select text_value에는 option sortKey 저장.
4. Audit event는 Phase 1에서 defer.
```

이 기본값을 바꾸려면 implementation plan 작성 전에 별도 설계 변경으로 처리한다.
