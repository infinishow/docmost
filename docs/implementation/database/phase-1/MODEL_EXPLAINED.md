# Database Phase 1 모델 설명

작성일: 2026-06-11

이 문서는 Docmost에 Notion식 Database를 올릴 때 Phase 1에서 만들 서버 데이터 모델을 이해하기 위한 설명서다. 테이블 컬럼을 먼저 보지 않고, 사용자가 보는 개념에서 출발한다.

## 한 줄 요약

Phase 1의 서버 모델은 다음 구조를 저장한다.

```text
기존 Docmost Page
  └─ DataSource
       ├─ Properties
       ├─ Records
       ├─ PropertyValues
       └─ Views
```

사용자 눈에는 이것이 다음처럼 보인다.

```text
"프로젝트 관리" 문서 안에
  "작업 목록" database가 있고
    제목, 상태, 담당자, 마감일 컬럼이 있으며
    여러 작업 row가 있고
    같은 row들을 전체 보기, 내 작업, 마감일순으로 볼 수 있다.
```

## 예시로 보는 전체 구조

예를 들어 Docmost에 `프로젝트 관리`라는 기존 문서가 있다고 하자.

그 문서 아래에 `작업 목록` database를 만든다.

```text
Page: 프로젝트 관리

  DataSource: 작업 목록

    Properties:
      - 제목
      - 상태
      - 담당자
      - 마감일

    Records:
      - 로그인 버그 수정
      - 결제 QA
      - 릴리즈 노트 작성

    PropertyValues:
      로그인 버그 수정 / 상태 = Doing
      로그인 버그 수정 / 담당자 = Jane
      로그인 버그 수정 / 마감일 = 2026-06-20

      결제 QA / 상태 = Todo
      결제 QA / 담당자 = Min
      결제 QA / 마감일 = 2026-06-22

    Views:
      - 전체 작업
      - 내 작업
      - 마감일순
```

핵심은 `DataSource`가 실제 데이터 묶음이라는 점이다. 화면에 보이는 table, board, calendar는 모두 같은 `DataSource`를 다르게 보여주는 방식이다.

## Notion 개념과 서버 모델 대응

| Notion/사용자 개념 | Phase 1 서버 모델 | 쉬운 설명 |
| --- | --- | --- |
| Database | DataSource | 실제 데이터 묶음 |
| Column | Property | 어떤 값을 받을지 정의하는 컬럼 |
| Row / Item / Record | Record | database의 한 줄 |
| Cell | PropertyValue | 특정 row의 특정 column 값 |
| View | View | 같은 데이터를 보여주는 방식 |
| Database가 들어있는 문서 | Parent Page | 권한과 소속을 제공하는 기존 Docmost page |

## 왜 DataSource가 중심인가

Database를 화면 자체로 보면 나중에 막힌다.

예를 들어 같은 `작업 목록`을 다음 방식으로 동시에 보고 싶을 수 있다.

```text
Table view
  모든 작업을 표로 보기

Board view
  상태별로 카드 보기

Calendar view
  마감일 기준으로 달력 보기

Linked database
  다른 문서에서 같은 작업 목록을 다시 보여주기
```

이때 table, board, calendar가 각각 데이터를 따로 소유하면 같은 작업이 여러 곳에 복제된다. 그래서 실제 데이터는 `DataSource`가 갖고, view는 표시 설정만 갖는 구조가 맞다.

```text
DataSource: 작업 목록
  ├─ Table view
  ├─ Board view
  ├─ Calendar view
  └─ Linked view
```

Phase 1에서는 table 화면도 만들지 않지만, 이 구조를 먼저 잡아야 Phase 2 이후 view를 붙일 수 있다.

## 5개 테이블이 필요한 이유

Phase 1 테이블은 사용자 개념과 거의 1:1로 대응된다.

```text
data_sources
  "작업 목록" 자체

data_source_properties
  제목, 상태, 담당자, 마감일 같은 컬럼 정의

data_source_records
  로그인 버그 수정, 결제 QA 같은 row

data_source_property_values
  row와 column이 만나는 cell 값

data_source_views
  전체 작업, 내 작업, 마감일순 같은 보기 설정
```

이 중 가장 헷갈리는 것은 `Record`와 `PropertyValue`의 분리다.

## Record와 PropertyValue를 분리하는 이유

Table로 보면 한 줄에 모든 값이 같이 있어서 row 하나에 모든 cell을 넣고 싶어진다.

```text
Record:
  제목 = 로그인 버그 수정
  상태 = Doing
  담당자 = Jane
  마감일 = 2026-06-20
```

하지만 실제 database에서는 컬럼이 계속 바뀐다.

```text
처음:
  제목, 상태

나중:
  제목, 상태, 담당자, 마감일, 우선순위
```

row 안에 모든 값을 고정 컬럼으로 넣으면 property 타입 추가, 삭제, 정렬, filter, sort가 어려워진다. 그래서 row 자체는 `Record`로 두고, cell 값은 `PropertyValue`로 따로 저장한다.

```text
Record: 로그인 버그 수정

  PropertyValue:
    property = 상태
    value = Doing

  PropertyValue:
    property = 담당자
    value = Jane
```

이 구조는 Notion식 database처럼 사용자가 컬럼을 자유롭게 추가/삭제하는 모델에 더 잘 맞는다.

## Page와 DataSource의 관계

Phase 1에서는 full-page database를 만들지 않는다. 대신 `DataSource`가 기존 Docmost page 아래에 소속된다.

```text
Page: 프로젝트 관리
  id = page_1

DataSource: 작업 목록
  parent_page_id = page_1
```

이렇게 하면 Phase 1에서 다음을 해결할 수 있다.

```text
권한
  사용자가 parent page를 볼 수 있으면 database도 볼 수 있다.
  사용자가 parent page를 편집할 수 있으면 database도 편집할 수 있다.

소속
  database가 어느 workspace/space/page에 속하는지 명확하다.

Phase 2 확장
  나중에 이 DataSource를 full-page database 화면으로 보여줄 수 있다.
```

중요한 점은 Phase 1에서 `pages` 테이블을 database page용으로 크게 바꾸지 않는다는 것이다. 기존 page 시스템을 건드리는 범위를 줄이고, 먼저 서버 데이터 모델을 안정화한다.

## Record page는 왜 나중에 만드는가

Notion에서 database row를 열면 page처럼 열린다. 하지만 Phase 1에서는 이것까지 바로 구현하지 않는다.

대신 record에는 `page_id`를 nullable로 둔다.

```text
Record: 로그인 버그 수정
  page_id = null
```

나중에 사용자가 이 record를 page로 열 때 기존 Docmost page를 만들고 연결한다.

```text
Record: 로그인 버그 수정
  page_id = page_99

Page: 로그인 버그 수정
  기존 Docmost editor로 본문 편집
```

이 방식을 쓰면 Phase 1에서 본문 협업, Hocuspocus, page history까지 한꺼번에 끌고 오지 않아도 된다.

## View는 데이터를 저장하지 않는다

View는 row 데이터를 복제하지 않는다. View는 어떤 row를 어떤 방식으로 보여줄지에 대한 설정이다.

예:

```text
View: 전체 작업
  type = table
  filter = 없음
  sort = 생성순

View: 내 작업
  type = table
  filter = 담당자 is me
  sort = 마감일 오름차순

View: 마감일순
  type = table
  filter = 마감일 is not empty
  sort = 마감일 오름차순
```

세 view는 모두 같은 `DataSource`의 `Records`를 조회한다.

## Phase 1에서 실제로 보장하려는 것

Phase 1의 목표는 화면을 만드는 것이 아니라 다음 서버 동작을 보장하는 것이다.

```text
DataSource 생성
  parent page 아래에 database 데이터 묶음을 만들 수 있다.

Property 생성/수정/삭제
  컬럼 schema를 관리할 수 있다.

Record 생성/수정/삭제
  row를 만들고 정렬 순서를 저장할 수 있다.

PropertyValue 수정
  특정 row의 특정 cell 값을 저장할 수 있다.

View 생성/수정/삭제
  table view 설정을 저장할 수 있다.

Query
  view 설정에 따라 record 목록을 서버에서 조회할 수 있다.

Permission
  parent page 권한을 기준으로 읽기/쓰기 가능 여부를 판단한다.
```

## Phase 1에서 아직 하지 않는 것

다음은 Phase 1 범위가 아니다.

```text
화면
  table UI
  cell editor
  toolbar
  view tabs

page 확장
  full-page database page type
  record page 본문 생성
  inline database block

고급 database 기능
  relation
  rollup
  formula
  board/calendar/gallery

실시간 UX
  websocket event 전파
  optimistic UI
  multi-user grid conflict UI
```

## 서버 API가 다루는 흐름

Phase 1 API는 대략 다음 흐름을 지원한다.

```text
1. 사용자가 parent page 아래에 database를 만든다.

   createDataSource(parentPageId, name)

2. 서버는 parent page를 찾고 권한을 확인한다.

   parent page exists?
   user can edit parent page?

3. 서버는 transaction 안에서 기본 구조를 만든다.

   data_sources row
   기본 title property
   기본 table view

4. 사용자가 컬럼을 추가한다.

   createProperty(dataSourceId, type, name)

5. 사용자가 row를 추가한다.

   createRecord(dataSourceId)

6. 사용자가 cell 값을 수정한다.

   updatePropertyValue(recordId, propertyId, value)

7. 화면은 view 기준으로 row를 조회한다.

   queryRecords(dataSourceId, viewId, pagination)
```

## 동시성은 어디에서 다루는가

Phase 1에서는 협업 editor처럼 cell 값을 CRDT로 병합하지 않는다.

대신 서버가 단일 판정 지점이 된다.

```text
Client A
  상태 = Doing 저장 요청

Client B
  상태 = Done 저장 요청

Server
  transaction으로 하나씩 처리
  같은 cell이면 나중 요청이 이김
  version 증가
```

이 방식은 앞서 정리한 실시간 협업 방식 중 `B. 서버 API + DB transaction + event 전파`에 해당한다.

Phase 1에서는 version column을 넣어 둔다. 실제 websocket event 전파와 충돌 UI는 Phase 3에서 붙인다.

## 최종 개념 그림

```text
Workspace
  Space
    Page: 프로젝트 관리
      DataSource: 작업 목록

        Properties
          title: 제목
          select: 상태
          person: 담당자
          date: 마감일

        Records
          record_1: 로그인 버그 수정
          record_2: 결제 QA

        PropertyValues
          record_1 + 상태 = Doing
          record_1 + 담당자 = Jane
          record_2 + 상태 = Todo
          record_2 + 마감일 = 2026-06-22

        Views
          전체 작업
          내 작업
          마감일순
```

Phase 1은 이 그림을 서버 DB와 API로 구현하는 단계다.
