# Docmost 작업 문서

이 디렉터리는 현재 작업 중인 조사/설계 문서를 성격별로 나눠 관리한다.

## 디렉터리 구분

```text
docs/
  research/
    제품/코드/동시성 조사 문서

  implementation/
    앞으로 구현할 기능의 아키텍처, 계획, 의사결정 문서

    database/
      Database 기능 구현 문서

      phase-1/
        Phase 1 서버 foundation 문서
```

## Research

조사 문서는 현재 상태를 이해하기 위한 자료다. 구현 결정을 직접 지시하기보다는, 판단 근거를 제공한다.

- `research/CODE_STRUCTURE.md`
- `research/NOTION_DATABASE_RESEARCH.md`
- `research/CONCURRENCY_RESEARCH.md`

## Implementation

구현 문서는 실제로 Docmost에 기능을 추가할 때 기준으로 삼는 설계/계획 문서다.

### Database

- `implementation/database/ARCHITECTURE.md`

### Database Phase 1

Phase 1은 서버 foundation 단계다. UI, full-page database, inline database block은 아직 포함하지 않는다.

- `implementation/database/phase-1/DESIGN.md`
- `implementation/database/phase-1/MODEL_EXPLAINED.md`
- `implementation/database/phase-1/REVIEW_NOTES.md`

## 기존 문서

- `CUSTOMIZATION_PLAN.md`

기존 작업 문서는 현재 위치를 유지한다. 필요하면 이후 별도 기준으로 정리한다.
