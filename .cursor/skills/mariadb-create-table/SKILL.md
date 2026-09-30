---
name: mariadb-create-table
description: >-
  Interactively designs a MariaDB/MySQL table then creates it on every database in
  go/dev_secret/config.json. Use when the user asks to create a table, design columns,
  add PK/comment fields, or apply DDL to all configured DB servers.
---

# MariaDB Create Table

`go/dev_secret/config.json`의 `databases`에 등록된 **모든** 서버에 같은 테이블을 만든다.
완료 시 DDL은 스크립트로 **동시에** 실행한다.

## When to use

사용자가 테이블 생성, 컬럼 설계, PK/comment 정의, 전체 DB에 DDL 적용을 요청할 때.

## Interactive workflow (follow in order)

매 단계에서 사용자는 **지금까지 추가한 필드 수정을 요청**할 수 있다. 수정 요청이 있으면 해당 필드를 고친 뒤 현재 단계로 돌아온다.

### 1. 테이블명 또는 목적
- 테이블명을 묻는다.
- **목적을 서술형**으로 입력하면: 테이블명 + 필요한 필드 초안(이름/타입/사이즈/PK/comment)을 자동 제안하고 승인을 받는다.
- 자동 필드명 규칙: `테이블약자_필드명`  
  - 약자 = PascalCase/카멜표기에서 대문자만 (예: `UserAccount` → `UA`)  
  - 예: 계정 사용자명 → `UA_UserName`

### 2. 테이블 코멘트
- 테이블 COMMENT를 묻는다. 비어 있거나 자동 요청이면 목적/테이블명 기준으로 한글 코멘트를 제안하고 승인을 받는다.

### 3. 필드명 또는 필드 성격
- 필드명 **또는** 성격을 묻는다.
- **성격만** 입력: 필드명·타입·사이즈·comment 초안을 자동 생성 → 사용자 승인 후 기억.  
  필드명 = `테이블약자_필드명` 규칙.
- **필드명을 명시**: 4번(타입)으로 진행.

### 4. 필드 타입
- 타입을 묻는다. 서술형이면 내용을 바탕으로 타입(및 필요 시 사이즈)을 자동 제안한다.

### 5. 필드 사이즈 (필요할 때만)
- `VARCHAR`/`CHAR`/`DECIMAL` 등 길이가 필요한 타입만 사이즈를 묻는다.
- `INT`/`BIGINT`/`DATETIME`/`TEXT`/`LONGTEXT`/`BOOLEAN`/`TINYINT` 등은 생략 가능.

### 6. 기본키 여부
- 해당 필드의 PK 여부를 묻는다. 복합 PK도 허용(여러 필드에 PK=예).

### 7. 필드 comment
- comment를 묻는다.
- 입력이 없거나 자동 요청이면 필드명·타입·사이즈·사용목적을 바탕으로 **한글 comment**를 자동 생성한다.

### 8. 현재 필드 확인 + 추가 여부
- 방금(또는 수정한) 필드 정보를 표로 보여 준다: 필드명 | 타입 | 사이즈 | 기본키 | comment
- 필드를 더 추가할지 묻는다.  
  - 추가 → **3번**으로  
  - 더 이상 없음 → **9번**으로

### 9. 전체 확인 + 생성
- 지금까지의 **모든** 필드를 같은 표 형식으로 보여 주고 완료 여부를 묻는다.
- **완료** → 아래 Create script로 `config.json`의 **모든** `databases`에 동시 생성. 서버별 성공/실패를 보고한다.
- 생성이 하나 이상 성공하면:
  1. **실제 테이블 구조**를 표로 화면에 표시한다.
  2. 그 아래 `CREATE TABLE` 쿼리를 보여 준다.
  3. 동일 내용을 `go/dev_secret/database/<테이블명>.md`에 저장한다.  
     (구조 표 + 그 아래 CREATE TABLE)
- **추가 입력** → **3번**으로 돌아간다.

## Create script

워크스페이스 루트에서, 승인된 스키마 JSON으로 실행:

```bash
python3 .cursor/skills/mariadb-create-table/scripts/create_table.py --schema schema.json
```

stdin:

```bash
python3 .cursor/skills/mariadb-create-table/scripts/create_table.py --schema - <<'JSON'
{
  "table": "UserAccount",
  "table_comment": "사용자 계정",
  "fields": [
    {
      "name": "UA_Id",
      "type": "BIGINT",
      "size": null,
      "primary_key": true,
      "auto_increment": true,
      "nullable": false,
      "comment": "사용자 계정 식별자"
    },
    {
      "name": "UA_UserName",
      "type": "VARCHAR",
      "size": 100,
      "primary_key": false,
      "nullable": false,
      "comment": "계정 사용자명"
    }
  ]
}
JSON
```

Options:
- `--config go/dev_secret/config.json` (default)
- `--if-not-exists` — `CREATE TABLE IF NOT EXISTS` 사용
- `--docs-dir go/dev_secret/database` (default) — `<테이블명>.md` 저장 위치

스크립트는 `databases` **전부**에 병렬로 DDL을 실행한다. 비밀번호를 출력하지 않는다.
성공한 DB(우선 `debug: true`)에서 `SHOW FULL COLUMNS` / `SHOW CREATE TABLE`로 실제 구조를 읽어
표로 출력하고 `go/dev_secret/database/<테이블명>.md`에 저장한다.

## Agent rules

- 자격 증명은 `config.json`에서만 읽고 채팅/커밋에 넣지 않는다.
- DDL 실행 전에 9번에서 사용자 완료 확인을 받는다.
- `DROP`/`TRUNCATE`는 이 스킬 범위가 아니다.
- 생성 결과는 서버(debug 여부·host·db name)별로 성공/에러를 표로 보여 준다.
- 생성 후 구조 표와 CREATE TABLE, 그리고 `go/dev_secret/database/<테이블명>.md` 저장 경로를 사용자에게 보여 준다.
  (`go/dev_secret/`는 gitignore 대상이므로 문서 파일은 커밋하지 않는다.)
