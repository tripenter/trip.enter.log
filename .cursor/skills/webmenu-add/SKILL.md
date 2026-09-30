---
name: webmenu-add
description: >-
  Interactively collects WebMenu fields then inserts a menu row into every
  database in go/dev_secret/config.json. Use when the user asks to add a menu,
  register WebMenu, create parent/child menus, or manage menu sort order.
---

# WebMenu Add

`go/dev_secret/config.json`의 `databases`에 등록된 **모든** DB에 같은 `WebMenu` 행을 추가한다.
스키마 참고: `go/dev_secret/database/WebMenu.md`.

## When to use

메뉴 추가, WebMenu 등록, 상위/하위 메뉴 생성, 메뉴 표시 순서 지정 요청 시.

## Interactive workflow (follow in order)

한 번에 하나씩 묻고, 답변을 기억한 뒤 다음으로 진행한다. **확인·승인 전에는 INSERT하지 않는다.**

### 1. 상위 메뉴명
- 상위 메뉴명을 묻는다.
- **입력이 없으면** 지금 메뉴를 상위(주)메뉴로 등록한다 → `WM_ParentId = NULL`.
- **입력이 있으면** `WM_Title`로 상위 메뉴를 조회해 `WM_ParentId`를 결정한다.
  - 없거나 여러 건이면 목록을 보여주고 선택을 받는다.
  - 목록 조회는 `debug: true` DB를 기준으로 한다.

### 2. 메뉴명(폴더명) → `WM_Folder`
- **1번에서 상위 메뉴명을 입력하지 않은 경우 이 질문은 생략**하고 `WM_Folder = NULL`.
- 그 외에는 묻는다.
- **입력이 없으면**: 특정 폴더와 연결되지 않은, 하위메뉴 표시용 상위메뉴 → `WM_Folder = NULL`.

### 3. 표시될 메뉴명 → `WM_Title`
- 웹페이지에 표시될 메뉴명을 묻는다. (필수)

### 4. 메뉴 표시 순서 → `WM_SortOrder`
- 상위메뉴는 상위메뉴끼리, 하위메뉴는 같은 상위 아래 하위메뉴끼리 순서를 관리한다.
- 대상 목록을 `WM_SortOrder` 오름차순으로 조회해 **순번을 매겨** 보여 준다. (`debug: true` 기준)
  - 상위 등록: `WM_ParentId IS NULL`
  - 하위 등록: `WM_ParentId = <상위 WM_Id>`
- 사용자가 숫자를 입력하면 **그 숫자 뒤**에 새 메뉴를 둔다.
  - `0` → 맨 앞
  - `N` → N번 메뉴 바로 뒤
- 목록이 비어 있으면 순서 입력 없이 `WM_SortOrder = 1`.

목록 조회 예:

```bash
python3 .cursor/skills/mariadb-query/scripts/query.py <<'SQL'
SELECT WM_Id, WM_Title, WM_Folder, WM_SortOrder, WM_IsActive
FROM WebMenu
WHERE WM_ParentId IS NULL
ORDER BY WM_SortOrder, WM_Id;
SQL
```

하위일 때는 `WM_ParentId IS NULL` 대신 `WM_ParentId = <id>`.

### 5. 활성여부 → `WM_IsActive`
- `1` = 활성, `0` = 비활성. (필수)

### 6. 확인 + 생성
- 입력값을 다시 표시한다. 예:
  - 상위 메뉴 / ParentId
  - 폴더 (`WM_Folder`, 없으면 NULL)
  - 표시명 (`WM_Title`)
  - 표시 순서 (몇 번 뒤 / 맨 앞)
  - 활성여부
  - 적용 대상: `config.json`의 **모든 databases**
- 메뉴를 만들지 여부를 묻는다.
- **승인 시에만** 아래 스크립트로 `INSERT`한다.
- 거부 시 INSERT하지 않고 종료(또는 수정할 항목을 다시 묻는다).

### 7. 하위메뉴 웹 폴더 생성 (INSERT 성공 후)
- **주메뉴**(`WM_ParentId` NULL)면 이 단계를 하지 않는다.
- **하위메뉴**이고 `WM_Folder`가 있으면:
  1. 프로젝트 `web/` 아래에 `WM_Folder` 경로로 폴더를 만든다. (예: `web/admin/users`)
  2. 그 폴더에 `index.html`을 만들고, 상단에는 동적 메뉴(`js/menu.js` → `POST /rest/get/menu`), 본문에는 **표시 메뉴명(`WM_Title`)** 을 넣는다.
- `WM_Folder`가 NULL인 하위메뉴(폴더 미연결 그룹용)는 파일/폴더를 만들지 않는다.
- `add_menu.py`가 전체 DB INSERT 성공 후 위 조건을 만족하면 scaffold를 **한 번** 수행한다.

## Insert script

```bash
python3 .cursor/skills/webmenu-add/scripts/add_menu.py \
  --title "대시보드" \
  --after 2 \
  --active 1
```

하위 메뉴 + 폴더:

```bash
python3 .cursor/skills/webmenu-add/scripts/add_menu.py \
  --parent-id 3 \
  --folder "admin/users" \
  --title "사용자 관리" \
  --after 0 \
  --active 1
```

Options:
- `--config go/dev_secret/config.json` (default)
- `--parent-id` — 생략하거나 비우면 주메뉴 (`WM_ParentId NULL`)
- `--folder` — 생략하면 `WM_Folder NULL`
- `--title` — 필수 (`WM_Title`)
- `--after` — 기존 목록 순번 뒤 (0=맨 앞). 형제 없으면 무시되고 1로 저장
- `--active` — `1` 또는 `0`

스크립트는 `databases` **전부**에 같은 정렬 밀어내기 + INSERT를 수행한다.
기준 DB(`debug: true` 우선)에서 받은 `WM_Id`를 나머지 DB에도 동일하게 넣어 ID를 맞춘다.
`WM_CreatedAt`/`WM_UpdatedAt`은 각 DB에서 `NOW()`로 설정한다. 비밀번호를 출력하지 않는다.
`--parent-id`와 `--folder`가 모두 있으면 INSERT 후 `web/<folder>/index.html`을 생성한다.
경로에 `..` 등 traversal이 있으면 scaffold를 건너뛴다.
서버별 성공/실패를 한 줄씩 보고한다.

## Agent rules

- 자격 증명은 `config.json`에서만 읽고 채팅/커밋에 넣지 않는다.
- 질문은 **순차**로 하고, 1번이 비어 있으면 2번을 건너뛴다.
- 6번 승인 전 INSERT 금지.
- INSERT는 항상 **모든 databases**에 적용한다.
- INSERT 후 서버별 `WM_Id`와 저장된 요약을 보여 준다.
- 하위메뉴 + `WM_Folder`가 있으면 `web/<WM_Folder>/index.html` 생성 여부도 보고한다.
