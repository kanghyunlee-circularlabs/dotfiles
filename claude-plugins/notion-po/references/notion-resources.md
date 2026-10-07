# 개발팀 Notion 리소스와 실행 규칙

notion-po 스킬들이 함께 쓰는 단일 출처다. ID·속성·실행 규칙은 여기만 고친다.

## 목차

- 대상 리소스 ID
- 스프린트 DB 속성
- 백로그 DB 속성
- 실행 규칙 (`scripts/ntn.ts`)

## 대상 리소스 ID

API 호출(쿼리·페이지 생성)에는 data source ID 를 쓴다. database ID 로는 쿼리가 안 된다. ID 가 바뀐 것 같으면 `ntn datasources resolve <database-id>` 로 다시 확인한다.

- 개발 스크럼 (스프린트 DB 부모 페이지): `3a3f68d9-4082-8096-a1af-dcf7797ef1d7`
- 스프린트
    - database: `3a3f68d9-4082-8084-9813-c8e2b5eb36a1`
    - data source: `3a3f68d9-4082-807e-8a43-000b9965f503`
- 백로그
    - database: `1d1f68d9-4082-8235-9889-014a90701890`
    - data source: `a07f68d9-4082-8359-9579-07c5578db49e`
- 에픽
    - database: `741f68d9-4082-8213-9f32-01f1bd372da3`
    - data source: `cdff68d9-4082-82aa-a99b-878327253130`

## 스프린트 DB 속성

- `이름` (title): 스프린트 제목. 형식은 `[{시작 YYMMDD}-{종료 YYMMDD}]{요약}`, 닫는 대괄호 뒤 공백 없음
- `기간` (date 범위): `start`~`end`
- `백로그` (relation → 백로그): dual property `⚡ 스프린트`
- `WIP` (formula): 연결된 백로그 스토리포인트 합(취소 제외). 직접 못 쓴다
- `생성일` (created_time)

## 백로그 DB 속성

- `작업 이름` (title): 팀 관행은 "{목적}을 위해, {행위}한다"
- `⚡ 스프린트` (relation → 스프린트): 소속 스프린트. 1개 제한
- `에픽` (relation → 에픽)
- `상태` (status): `제품`·`스프린트`·`진행 중`·`스테이징`·`완료`·`취소` 중 하나만
- `작업크기`·`비즈니스가치`·`긴급도`·`위험도` (select): `1`·`2`·`3`·`5`·`8` 중 하나만. 다른 값을 쓰면 Notion 이 새 옵션을 만든다
- `우선순위`·`스토리포인트` (formula): 위 네 점수로 자동 계산. 직접 못 쓴다
- `가치판단` (rich_text): 네 점수의 근거. 형식은 backlog-scoring 스킬
- `지연사유` (rich_text): 이월 시 "왜 못 끝냈는지 + 어디로 이월했는지". 본문 블록이 아니라 이 속성에 쓴다
- `긴급` (checkbox), `기간` (date)
- `작업자` (people): 쓰려면 Notion user ID 가 필요하다. `ntn.ts backlog --json` 결과의 `people` 에서 이름→ID 맵을 만든다

## 실행 규칙 (`scripts/ntn.ts`)

Notion 조회·쓰기는 플러그인의 `scripts/ntn.ts` 를 실행한다. 경로는 `${CLAUDE_PLUGIN_ROOT}/scripts/ntn.ts` 다. 치환이 안 된 채 보이면 이 파일 기준 `../scripts/ntn.ts` 를 쓴다. 실행기는 `bun` 이다.

- 조회
    - `bun ntn.ts sprints`: 스프린트 전체, 한 줄에 `id | 이름 | start ~ end`
    - `bun ntn.ts current-sprints`: 이번·지난 스프린트 판정과 기간 없는 빈 행 목록(JSON)
    - `bun ntn.ts backlog [--sprint <page_id>] [--unscored] [--json]`: 백로그 상태·작업자·포인트·점수
    - `bun ntn.ts query-all <ds> [--filter <json>]`: 그 밖의 조회. 결과는 `results` 배열
- 쓰기
    - 본문 JSON 은 **Write 도구로** 작업 디렉터리의 임시 파일에 쓴다. 셸 heredoc 은 한글·`·`·`—` 가 섞이면 깨진다
    - 한 건: `bun ntn.ts write <api_path> <METHOD> <body.json>`
    - 여러 건: `[{label, path, method, body}]` 배열을 파일로 쓰고 `bun ntn.ts batch <ops.json>`. 실패 건을 모아 마지막에 보고한다
    - 처음 쓰는 형태의 쓰기는 `--dry-run` 으로 명령과 바디를 먼저 본다
    - 응답 `object` 가 `error` 면 스크립트가 0 이 아닌 값으로 끝난다. 그때는 멈추고 `code`/`message` 를 보고한다
- 스크립트가 대신 막아 주는 것 (직접 `ntn` 을 부를 때는 손으로 지킨다)
    - 페이지 넘김: `ntn datasources query` 기본 크기는 25건이다. 첫 장만 보고 "없다" 고 판정하면 중복을 만든다
    - stdin 닫기: 비대화 환경에서 `ntn api`·`datasources`·`pages` 가 stdin 바디를 기다리며 멈춘다. 직접 부를 때는 `< /dev/null`
    - 호출당 60초 제한, 임시 파일은 호출마다 새로 만들고 지운다
