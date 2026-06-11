# Notion Database 기능 조사

조사일: 2026-06-11

이 문서는 Docmost에 Notion식 Database 기능을 추가할지 검토하기 위해, Notion 공식 문서를 기준으로 Database 기능의 개념과 주요 구성요소를 정리한 것이다.

## 요약

Notion의 Database는 단순한 문서 안의 표가 아니다. 핵심은 "페이지 컬렉션 + 구조화된 속성 + 여러 보기 + 필터/정렬/그룹 + 관계/계산"이다.

Notion에서 Database의 각 항목은 하나의 페이지이고, Database 자체도 페이지처럼 배치되거나 중첩될 수 있다. 각 항목은 제목, 텍스트, 숫자, 선택값, 날짜, 사람, 파일, 관계, 롤업, 수식 같은 속성을 가진다. 같은 데이터는 table, board, timeline, calendar, list, gallery, chart, form, map 등의 여러 view로 표시될 수 있다.

Docmost 관점에서는 일반 에디터 table 기능과 완전히 다른 제품 영역이다. 구현한다면 에디터 extension 하나로 끝나지 않고, 서버 데이터 모델, 권한, 검색, API, 클라이언트 grid/view UI, 페이지와 database record의 관계까지 포함하는 큰 기능으로 봐야 한다.

## Notion Database의 핵심 개념

### 1. Database는 페이지의 컬렉션이다

Notion 공식 설명에서 Database는 여러 Notion 페이지를 한 구조 안에서 관리하는 컨테이너다. Table view에서는 각 row가 Database 안의 page다.

즉, Notion의 Database item은 일반적인 스프레드시트 row에 가깝지만, 동시에 열어보면 본문을 가진 문서 페이지이기도 하다.

더 구체적으로 보면 다음과 같다.

```text
Database 화면 또는 Database 블록
  View
    같은 데이터를 table, board, calendar 등으로 보여주는 표시 방식
  Data source
    실제 데이터가 저장되는 항목 묶음
    Database page / item / record
      한 줄(row), 한 카드(card), 한 일정(event)으로 보이는 개별 항목
      Properties
        제목, 상태, 담당자, 날짜 같은 구조화된 필드
      Page content blocks
        항목을 열었을 때 보이는 일반 문서 본문
```

예를 들어 `Tasks`라는 Notion database가 있다고 하면 다음처럼 이해할 수 있다.

```text
Tasks database
  View: Table
    "업무 목록을 표로 보여줘"
  View: Board
    "같은 업무들을 Status 기준 칸반 보드로 보여줘"
  Data source: Tasks
    Record: "로그인 버그 수정"
      Properties
        Title = 로그인 버그 수정
        Status = In progress
        Assignee = Alex
        Due date = 2026-06-20
      Page content blocks
        버그 재현 방법
        원인 분석
        수정 계획

    Record: "릴리즈 노트 작성"
      Properties
        Title = 릴리즈 노트 작성
        Status = Not started
        Assignee = Mina
        Due date = 2026-06-22
      Page content blocks
        릴리즈 요약
        변경사항 목록
```

중요한 점은 table row가 단순 텍스트 줄이 아니라는 것이다. `로그인 버그 수정`이라는 row를 클릭하면 그 자체가 하나의 page로 열리고, 그 안에 일반 문서처럼 본문을 쓸 수 있다. Row 바깥에 보이는 `Status`, `Assignee`, `Due date`는 그 page에 붙은 metadata/property다.

Docmost에 비유하면 `Page`가 문서 본문만 가지는 것이 아니라, 특정 `Database`에 속한 `Record`가 되고, 그 record가 property 값을 가지며, 동시에 page body도 가지는 모델이 필요하다.

### 2. Database 자체도 페이지처럼 취급된다

Notion에서는 database도 페이지 자체다. 따라서 다른 콘텐츠 옆에 배치하거나, 페이지 안에 inline database로 넣거나, full-page database로 열 수 있다.

Docmost에 도입한다면 다음 두 UX를 분리해서 생각해야 한다.

- Full-page database: 하나의 페이지가 database 화면 자체로 동작
- Inline database block: 일반 문서 본문 안에 database view를 삽입

### 3. Data source와 view가 분리된다

최근 Notion Database는 "database"와 "data source" 개념을 구분한다. 이 구분이 헷갈리기 쉬운데, 간단히 말하면 database는 화면에 놓이는 컨테이너이고, data source는 실제 record들이 들어 있는 데이터 묶음이다. View는 그 data source를 어떤 모양으로 보여줄지 정하는 설정이다.

기본 개념은 다음과 같다.

```text
Data source
  실제 record와 property schema가 있는 곳
  예: Tasks, Projects, Customers

Database view
  data source를 특정 layout/filter/sort/group으로 보여주는 설정
  예: 내 업무, 이번 스프린트 보드, 마감일 캘린더

Database block/page
  하나 이상의 view를 페이지 안에서 보여주는 컨테이너
  예: 프로젝트 문서 안에 삽입된 "이 프로젝트의 Tasks" 표
```

예를 들어 같은 `Tasks` data source를 여러 곳에서 다르게 보여줄 수 있다.

```text
원본 Tasks data source
  모든 업무 record가 저장됨

홈 대시보드의 linked view
  filter: Assignee = 나
  layout: Table

스프린트 페이지의 linked view
  filter: Sprint = 현재 스프린트
  layout: Board
  group: Status

캘린더 페이지의 linked view
  layout: Calendar
  date property: Due date
```

즉, data source는 하나지만 view는 여러 개일 수 있다. View를 바꿔도 데이터가 복사되는 것은 아니고, 같은 record들을 다른 방식으로 보여주는 것이다.

이 모델을 그대로 구현하면 유연하지만 복잡도가 높다. Docmost MVP에서는 먼저 `database = single data source`로 시작하고, linked view나 multi-source는 후순위로 두는 것이 현실적이다.

## 주요 기능 범위

### Database item

각 item은 다음 특성을 가진다.

- Database 안의 한 행 또는 카드로 표시된다.
- 독립적인 page로 열 수 있다.
- 속성 값을 가진다.
- page body에 일반 문서 블록을 작성할 수 있다.
- 권한, 댓글, 멘션, backlink 등 기존 page 기능과 연결될 수 있다.

Docmost에서 가장 중요한 설계 질문은 "database item을 기존 page 테이블의 특수 타입으로 볼 것인가, 별도 record로 볼 것인가"이다.

### Properties

Notion의 property는 database item에 붙는 구조화된 필드다. 공식 문서 기준 주요 property 유형은 다음과 같다.

| Property | 의미 |
| --- | --- |
| Title | item의 기본 이름. Database item page의 제목 역할 |
| Text | 자유 텍스트 |
| Number | 숫자, 통화, 진행률 등 |
| Select | 단일 선택 태그 |
| Status | 할 일/진행 중/완료 같은 상태 분류 |
| Multi-select | 다중 선택 태그 |
| Date | 날짜 또는 날짜 범위, 시간 포함 가능 |
| Formula | 다른 속성을 기반으로 계산 |
| Relation | 다른 database의 page와 연결 |
| Rollup | relation으로 연결된 항목의 속성을 집계/표시 |
| Person | 워크스페이스 사용자 |
| Files & media | 파일 또는 미디어 |
| Checkbox | true/false |
| URL | URL |
| Email | 이메일 |
| Phone | 전화번호 |
| Created time | 생성 시각 |
| Created by | 생성자 |
| Last edited time | 마지막 수정 시각 |
| Last edited by | 마지막 수정자 |
| Button | database item에서 실행하는 버튼형 액션 |
| ID / Unique ID | 자동 생성되는 고유 식별자 |

Docmost MVP에서 우선순위를 잡는다면 다음이 적절하다.

1. Title, Text, Number, Select, Multi-select, Status, Date, Checkbox, Person
2. URL, Email, Files, Created/Edited metadata
3. Relation, Rollup
4. Formula, Button, Unique ID

Relation/Rollup/Formula는 Notion Database의 강력한 차별점이지만, 초기 구현 난이도와 성능 부담이 크다.

### Views

Notion은 같은 database 데이터를 여러 layout으로 보여준다. 공식 문서 기준 주요 view는 다음과 같다.

| View | 역할 |
| --- | --- |
| Table | row/column 형태. 모든 property를 column으로 표시 |
| Board | 특정 property로 group을 나눈 kanban 형태 |
| Timeline | 기간성 date property를 기반으로 일정 표시 |
| Calendar | date property를 달력에 표시 |
| List | 간단한 목록형 표시 |
| Gallery | 이미지/커버 중심 카드형 표시 |
| Chart | bar, line, donut 등으로 데이터 시각화 |
| Form | database에 연결된 입력 폼 |
| Map | 위치 정보 기반 표시 |
| Feed | feed 형태 표시 |
| Dashboard | 여러 데이터 표시/분석을 묶는 view |

Docmost MVP에서는 다음 순서가 현실적이다.

1. Table view
2. Board view
3. Calendar view
4. Gallery/List view
5. Timeline/Chart/Form/Map

Table view 없이 다른 view를 먼저 만들기는 어렵다. property 편집, row 생성, column 표시/숨김, filter/sort UI의 기준 화면이 table이기 때문이다.

### Filter, Sort, Group

Notion view는 같은 data source라도 view마다 다른 filter, sort, group 설정을 가진다.

예시:

```text
Tasks database
  View: My tasks
    filter: assignee = current user
    sort: due date asc

  View: Sprint board
    filter: sprint = current sprint
    group: status

  View: Calendar
    layout: calendar
    date property: due date
```

따라서 view 설정은 database 자체가 아니라 view별 configuration으로 저장해야 한다.

필요한 view config 예시는 다음과 같다.

```text
View
  name
  layout
  visible properties
  property order
  filters
  sorts
  groups
  layout-specific settings
```

### Relations

Relation은 서로 다른 database의 item을 연결하는 property다.

예를 들어:

```text
Projects database
  Project A

Tasks database
  Task 1
    Project relation = Project A
```

이 기능은 Notion을 단순 표가 아니라 가벼운 relational workspace로 만드는 핵심 기능이다.

설계상 고려할 점:

- 단방향/양방향 relation
- one-to-one, one-to-many, many-to-many
- linked database view와의 연결
- 연결된 target page를 현재 사용자가 볼 수 없는 경우의 표시 처리
- 삭제된 item 또는 이동된 item 처리

### Rollups

Rollup은 relation으로 연결된 item들의 property를 가져오거나 집계하는 기능이다.

예를 들어:

```text
Projects database
  Progress rollup = 연결된 Tasks 중 완료된 비율

Tasks database
  Status = Complete / In progress
```

Rollup은 relation 없이는 의미가 없다. 또한 filter/sort와 결합되면 성능 부담이 커진다. 초기 구현에서는 제외하거나 읽기 전용 계산 필드로 제한하는 것이 좋다.

### Formulas

Formula property는 다른 property 값을 참조해서 계산 결과를 만든다.

예시:

```text
Due date = dateAdd(Start Date, 2, "week")
Progress = Completed tasks / Total tasks
```

구현 관점에서는 자체 expression language가 필요하다. 선택지는 다음과 같다.

- 아주 제한된 내장 함수만 지원
- JavaScript expression을 sandbox에서 실행
- 별도 formula parser/interpreter 구현
- 초기에는 Formula를 지원하지 않음

보안과 성능을 생각하면 JavaScript expression 직접 실행은 피하는 편이 낫다.

### Database templates

Database template은 같은 database 안에서 새 item/page를 만들 때 반복되는 page 구조와 property 기본값을 재사용하는 기능이다.

예:

- 회의록 template
- 버그 리포트 template
- PRD template
- 프로젝트 template

Docmost에 도입하면 기존 page template 기능과 겹칠 수 있다. 차이는 database template은 특정 database schema와 property 기본값에 묶인다는 점이다.

### Sub-items and dependencies

Notion은 database item 간 parent/child 관계를 만들어 sub-item을 표현할 수 있다. task database에서는 sub-task처럼 동작한다. Dependency는 task 간 선후 관계를 표현한다.

이 기능은 relation의 특수한 형태로 볼 수 있다.

```text
Task
  Sub-items: Task[]
  Blocked by: Task[]
  Blocking: Task[]
```

MVP에서는 일반 relation 이후에 추가하는 편이 낫다.

### Unique ID

Unique ID는 database item마다 자동으로 부여되는 ID property다. 예를 들어 `TASK-123` 같은 식별자를 만들 수 있고, prefix가 있는 경우 URL로 접근하는 기능도 있다.

이 기능은 task/project 관리에서 유용하지만, database core보다 후순위 기능이다.

### Linked database

Linked database는 같은 data source를 다른 페이지에 다른 view/filter/sort로 보여주는 기능이다.

예:

```text
Project page
  Linked view of Tasks
    filter: project = current project
```

Docmost에 구현한다면 inline database block과 view config 재사용이 필요하다.

## Notion Database와 일반 Table의 차이

| 구분 | 일반 문서 Table | Notion Database |
| --- | --- | --- |
| 데이터 단위 | 셀 텍스트 | record/page |
| 행 | 문서 블록 일부 | 독립 item/page |
| 열 | 단순 column | 타입이 있는 property |
| 보기 | 표 하나 | table/board/calendar/gallery 등 다중 view |
| 필터/정렬 | 보통 없음 또는 단순 UI | view별 filter/sort/group |
| 관계 | 없음 | 다른 database item과 relation |
| 계산 | 없음 | formula/rollup |
| 재사용 | 문서 안에서만 | linked view로 여러 페이지에 재사용 |
| 권한 | 문서 권한 | database/page/item 권한 고려 필요 |

Docmost의 현재 table editor extension은 왼쪽에 가깝다. Notion Database는 오른쪽이다.

## Docmost에 추가할 때의 제품 범위 제안

### MVP 1: Database core + Table view

목표: Notion Database의 최소 핵심만 구현한다.

포함:

- Database 생성
- Database item 생성/삭제/수정
- 각 item을 page처럼 열기
- Property schema 관리
- 기본 property 타입
  - Title
  - Text
  - Number
  - Select
  - Multi-select
  - Status
  - Date
  - Checkbox
  - Person
- Table view
- column 표시/숨김/순서 변경
- 기본 filter/sort
- inline database block 또는 full-page database 중 하나

제외:

- Relation
- Rollup
- Formula
- Board/calendar/gallery
- Linked database
- Templates
- Automations

### MVP 2: View 확장

포함:

- View 여러 개 저장
- Board view
- List/Gallery view
- Calendar view
- view별 filter/sort/group
- linked database block

### MVP 3: Relation 계층

포함:

- Relation property
- Rollup property
- Sub-items
- Dependency
- Project/task 특화 UX

### MVP 4: 고급 기능

포함:

- Formula
- Database templates
- Unique ID
- Form view
- Chart/dashboard
- Automations
- Import/export 고도화

## Docmost 구현 관점의 데이터 모델 초안

아래는 개념 설계이며, 실제 Docmost schema에 맞춰 조정해야 한다.

```text
databases
  id
  workspace_id
  space_id
  page_id            // full-page database 또는 owner page
  name
  created_at
  updated_at

database_properties
  id
  database_id
  name
  type
  config_json
  sort_order
  hidden_default

database_records
  id
  database_id
  page_id            // record body page
  title
  created_by_id
  updated_by_id
  created_at
  updated_at

database_property_values
  id
  database_id
  record_id
  property_id
  value_json

database_views
  id
  database_id
  name
  layout
  config_json        // visible columns, filters, sorts, groups, layout settings
  sort_order
```

Relation을 추가하면 별도 edge table이 필요하다.

```text
database_relations
  id
  property_id
  source_record_id
  target_record_id
```

## 구현상 큰 쟁점

### 기존 Page 모델과의 통합

Notion식으로 가려면 database item이 page여야 한다. Docmost의 기존 page permission, tree, history, search, comments, collaboration과 충돌하지 않게 통합해야 한다.

질문:

- database item page가 page tree에 보이는가?
- item page의 parent는 database인가?
- item page URL은 기존 page URL과 같은가?
- item page 권한은 database 권한을 상속하는가?

### 권한

이 섹션은 Notion에 실제로 있는 권한 개념과 Docmost MVP에서 단순화할 권한 모델을 분리해서 봐야 한다. Notion에도 없는 세부 권한을 Docmost에 억지로 추가하는 것은 피하는 편이 좋다.

Notion 공식 문서 기준으로 확인되는 권한 개념은 다음과 같다.

- Database 자체는 page다. 따라서 database page에 공유/권한을 설정할 수 있다.
- Database의 각 row/item도 page다. 따라서 row page 단위로도 공유/권한을 설정할 수 있다.
- Database page에는 `Can edit content` 권한이 있다. 이 권한은 database 안의 page 생성/삭제/수정과 property value 수정을 허용하지만, property schema, view, sort/filter 같은 database 구조 변경은 허용하지 않는다.
- Person property 또는 Created by property를 기준으로 database 접근을 제한하는 기능이 있다. 이 설정은 모든 view와 linked view에도 반영된다.

반대로, 공식 문서 기준으로 Notion의 핵심 권한 모델이라고 보기 어려운 것은 다음과 같다.

- property별 보안 권한
- view별 독립 보안 권한
- relation/rollup 전용 세부 권한

Notion의 `Property visibility`는 특정 view나 page layout에서 property를 숨기거나 보여주는 표시 설정에 가깝다. 이것을 민감한 column을 보호하는 보안 권한으로 해석하면 안 된다.

Docmost MVP에서는 다음처럼 단순화하는 것이 현실적이다.

```text
Database page 권한
  database 자체 접근 권한

Record page 권한
  row가 page이므로 기존 page 권한 모델을 재사용
  MVP에서는 database page 권한을 기본 상속

Can edit content에 해당하는 권한
  record 생성/삭제/수정 가능
  property value 수정 가능
  property schema/view/filter/sort 구조 변경은 불가

Structure edit 권한
  property 추가/삭제/타입 변경 가능
  view 생성/수정 가능
  filter/sort/group 기본 설정 변경 가능
```

초기에는 다음 기능을 만들지 않는 것이 좋다.

- property별 접근 제어
- view별 접근 제어
- relation cell별 접근 제어
- rollup 결과별 접근 제어

Relation이나 Rollup을 나중에 추가할 때도 별도 권한 체계를 새로 만들기보다는, 연결된 target page 또는 target database에 대한 기존 page 권한을 존중하는 방향이 맞다. 예를 들어 사용자가 연결된 target page를 볼 수 없다면 relation cell에서 제목이나 상세 값을 노출하지 않아야 한다.

### 성능

Filter/sort/group이 property value JSON 위에서 동작하면 row 수가 늘 때 느려질 수 있다.

처음에는 다음 전략이 현실적이다.

- 자주 쓰는 primitive property는 query 가능한 형태로 저장
- 복잡한 값은 JSON으로 저장
- relation/rollup/formula는 후순위
- pagination/virtualized table 필수

### 실시간 협업

Docmost 문서 본문은 collaborative editing 흐름이 있지만, database grid 편집은 별도 실시간 동기화가 필요할 수 있다.

초기에는 optimistic update + refetch로 시작하고, 이후 websocket/event 기반 업데이트를 붙일 수 있다.

### 에디터와의 관계

Database block은 일반 Tiptap table extension과 다르다. 에디터 문서 안에는 database block node가 들어가고, 실제 rows/properties는 서버 database에 저장되는 방식이 적합하다.

```text
Editor document
  databaseBlock
    attrs:
      databaseId
      viewId
```

## 참고한 공식 문서

- Notion Help: What is a database
  - https://www.notion.com/help/what-is-a-database
- Notion Help: Intro to databases
  - https://www.notion.com/help/intro-to-databases
- Notion Help: Database properties
  - https://www.notion.com/help/database-properties
- Notion Help: Views, filters, sorts & groups
  - https://www.notion.com/help/views-filters-and-sorts
- Notion Help: Relations & rollups
  - https://www.notion.com/help/relations-and-rollups
- Notion Help: Intro to formulas
  - https://www.notion.com/help/formulas
- Notion Help: Data sources
  - https://www.notion.com/help/data-sources-and-linked-databases
- Notion Help: Database templates
  - https://www.notion.com/help/database-templates
- Notion Help: Sub-items & dependencies
  - https://www.notion.com/help/tasks-and-dependencies
- Notion Help: Unique ID
  - https://www.notion.com/help/unique-id
