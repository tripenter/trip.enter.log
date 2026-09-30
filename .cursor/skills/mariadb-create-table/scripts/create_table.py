#!/usr/bin/env python3
"""Create a table on every database listed in go/dev_secret/config.json (in parallel)."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any


def workspace_root() -> Path:
    # .cursor/skills/mariadb-create-table/scripts/create_table.py -> workspace
    return Path(__file__).resolve().parents[4]


def load_all_databases(config_path: Path) -> list[dict[str, Any]]:
    with config_path.open(encoding="utf-8") as f:
        cfg = json.load(f)

    entries = cfg.get("databases")
    if not isinstance(entries, list) or not entries:
        legacy = cfg.get("database")
        if isinstance(legacy, dict):
            entries = [legacy]
        else:
            raise SystemExit(f"config에 databases 섹션이 없습니다: {config_path}")

    required = ("host", "port", "user", "password", "name")
    cleaned: list[dict[str, Any]] = []
    for i, item in enumerate(entries):
        if not isinstance(item, dict):
            raise SystemExit(f"databases[{i}] 형식이 올바르지 않습니다")
        missing = [k for k in required if k not in item]
        if missing:
            raise SystemExit(f"databases[{i}] 설정 누락: {', '.join(missing)}")
        cleaned.append(item)
    return cleaned


def sql_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def column_sql(field: dict[str, Any]) -> str:
    name = field["name"]
    typ = str(field["type"]).upper().strip()
    size = field.get("size")
    nullable = field.get("nullable", not field.get("primary_key", False))
    auto_inc = bool(field.get("auto_increment", False))
    comment = field.get("comment") or ""

    type_sql = typ
    if size is not None and size != "" and typ in {
        "VARCHAR",
        "CHAR",
        "VARBINARY",
        "BINARY",
        "DECIMAL",
        "NUMERIC",
        "FLOAT",
        "DOUBLE",
    }:
        type_sql = f"{typ}({size})"
    elif size is not None and size != "" and typ not in {
        "TEXT",
        "LONGTEXT",
        "MEDIUMTEXT",
        "TINYTEXT",
        "BLOB",
        "LONGBLOB",
        "JSON",
        "DATE",
        "DATETIME",
        "TIMESTAMP",
        "TIME",
        "YEAR",
        "BOOLEAN",
        "BOOL",
        "TINYINT",
        "SMALLINT",
        "INT",
        "INTEGER",
        "BIGINT",
    }:
        type_sql = f"{typ}({size})"

    parts = [f"`{name}`", type_sql]
    parts.append("NULL" if nullable else "NOT NULL")
    if auto_inc:
        parts.append("AUTO_INCREMENT")
    if comment:
        parts.append(f"COMMENT {sql_string(str(comment))}")
    return " ".join(parts)


def build_create_sql(schema: dict[str, Any], *, if_not_exists: bool) -> str:
    table = schema["table"]
    table_comment = schema.get("table_comment") or ""
    fields = schema.get("fields") or []
    if not table:
        raise SystemExit("schema.table 이 필요합니다")
    if not fields:
        raise SystemExit("schema.fields 가 비어 있습니다")

    cols = [column_sql(f) for f in fields]
    pk = [f["name"] for f in fields if f.get("primary_key")]
    if pk:
        pk_list = ", ".join(f"`{n}`" for n in pk)
        cols.append(f"PRIMARY KEY ({pk_list})")

    kw = "CREATE TABLE IF NOT EXISTS" if if_not_exists else "CREATE TABLE"
    body = ",\n  ".join(cols)
    sql = f"{kw} `{table}` (\n  {body}\n)"
    if table_comment:
        sql += f" COMMENT={sql_string(str(table_comment))}"
    sql += ";"
    return sql


def mysql_cmd(
    db: dict[str, Any],
    sql: str,
    *,
    batch: bool = False,
    raw: bool = False,
) -> subprocess.CompletedProcess[str]:
    cmd = [
        "mysql",
        f"--host={db['host']}",
        f"--port={db['port']}",
        f"--user={db['user']}",
        f"--password={db['password']}",
        "--default-character-set=utf8mb4",
        db["name"],
    ]
    if batch:
        cmd.append("--batch")
        if raw:
            cmd.append("--raw")
    cmd.extend(["-e", sql])
    return subprocess.run(cmd, capture_output=True, text=True)


def clean_mysql_err(stderr: str) -> str:
    return "\n".join(
        line
        for line in (stderr or "").splitlines()
        if "Using a password on the command line" not in line
    ).strip()


def run_on_db(db: dict[str, Any], sql: str) -> dict[str, Any]:
    label = {
        "debug": bool(db.get("debug", False)),
        "host": db["host"],
        "port": db["port"],
        "name": db["name"],
        "user": db["user"],
        "db": db,
    }
    result = mysql_cmd(db, sql)
    err = clean_mysql_err(result.stderr)
    return {
        **label,
        "ok": result.returncode == 0,
        "error": err if result.returncode != 0 else "",
    }


def print_results(results: list[dict[str, Any]]) -> None:
    print("| debug | host | port | database | user | result | detail |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for r in results:
        detail = (r.get("error") or "").replace("|", "\\|").replace("\n", " ")
        status = "OK" if r["ok"] else "FAIL"
        print(
            f"| {r['debug']} | {r['host']} | {r['port']} | {r['name']} | {r['user']} | {status} | {detail} |"
        )


def pick_source_db(results: list[dict[str, Any]], databases: list[dict[str, Any]]) -> dict[str, Any] | None:
    ok = [r for r in results if r["ok"]]
    if not ok:
        return None
    ok.sort(key=lambda r: (0 if r["debug"] else 1, r["host"], r["name"]))
    # map back to full db credentials
    chosen = ok[0]
    for db in databases:
        if (
            bool(db.get("debug", False)) == chosen["debug"]
            and db["host"] == chosen["host"]
            and int(db["port"]) == int(chosen["port"])
            and db["name"] == chosen["name"]
            and db["user"] == chosen["user"]
        ):
            return db
    return chosen.get("db")


def fetch_structure_markdown(db: dict[str, Any], table: str) -> str:
    # Field, Type, Null, Key, Default, Extra, Comment
    sql = f"SHOW FULL COLUMNS FROM `{table}`;"
    result = mysql_cmd(db, sql, batch=True, raw=True)
    if result.returncode != 0:
        raise RuntimeError(clean_mysql_err(result.stderr) or "SHOW FULL COLUMNS 실패")

    lines = [ln for ln in (result.stdout or "").splitlines() if ln != ""]
    if not lines:
        return "_컬럼 없음_"

    rows = [line.split("\t") for line in lines]
    header = rows[0]
    # Prefer Korean-friendly subset if classic SHOW FULL COLUMNS headers
    # Field Type Collation Null Key Default Extra Privileges Comment
    wanted = ["Field", "Type", "Null", "Key", "Default", "Extra", "Comment"]
    indexes = []
    for name in wanted:
        if name in header:
            indexes.append(header.index(name))
        else:
            indexes.append(None)

    def cell(v: str) -> str:
        if v == "NULL":
            return "NULL"
        return v.replace("|", "\\|").replace("\n", " ")

    out_header = [wanted[i] for i, idx in enumerate(indexes) if idx is not None]
    if not out_header:
        out_header = header
        indexes = list(range(len(header)))

    md = [
        "| " + " | ".join(out_header) + " |",
        "| " + " | ".join("---" for _ in out_header) + " |",
    ]
    for row in rows[1:]:
        vals = []
        for idx in indexes:
            if idx is None:
                continue
            vals.append(cell(row[idx] if idx < len(row) else ""))
        md.append("| " + " | ".join(vals) + " |")
    return "\n".join(md)


def fetch_show_create_table(db: dict[str, Any], table: str) -> str:
    # Avoid --raw so newlines inside Create Table are escaped as \n in batch output.
    sql = f"SHOW CREATE TABLE `{table}`;"
    result = mysql_cmd(db, sql, batch=True, raw=False)
    if result.returncode != 0:
        raise RuntimeError(clean_mysql_err(result.stderr) or "SHOW CREATE TABLE 실패")
    lines = [ln for ln in (result.stdout or "").splitlines() if ln != ""]
    if len(lines) < 2:
        raise RuntimeError("SHOW CREATE TABLE 결과가 비어 있습니다")
    parts = lines[1].split("\t", 1)
    if len(parts) < 2:
        raise RuntimeError("SHOW CREATE TABLE 파싱 실패")
    ddl = parts[1]
    ddl = ddl.replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")
    if not ddl.rstrip().endswith(";"):
        ddl = ddl.rstrip() + ";"
    return ddl


def safe_table_filename(table: str) -> str:
    name = re.sub(r"[^\w.\-]+", "_", table.strip())
    return name or "table"


def write_database_doc(
    *,
    table: str,
    structure_md: str,
    create_sql: str,
    out_dir: Path,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{safe_table_filename(table)}.md"
    content = (
        f"# `{table}`\n\n"
        f"## 테이블 구조\n\n"
        f"{structure_md}\n\n"
        f"## CREATE TABLE\n\n"
        f"```sql\n{create_sql}\n```\n"
    )
    path.write_text(content, encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Create table on all config.json databases")
    parser.add_argument(
        "--config",
        default=str(workspace_root() / "go" / "dev_secret" / "config.json"),
        help="Path to config.json",
    )
    parser.add_argument(
        "--schema",
        required=True,
        help="Schema JSON file path, or '-' for stdin",
    )
    parser.add_argument(
        "--if-not-exists",
        action="store_true",
        help="Use CREATE TABLE IF NOT EXISTS",
    )
    parser.add_argument(
        "--print-sql-only",
        action="store_true",
        help="Print DDL only; do not execute",
    )
    parser.add_argument(
        "--docs-dir",
        default=str(workspace_root() / "go" / "dev_secret" / "database"),
        help="Where to write <table>.md (default: go/dev_secret/database)",
    )
    args = parser.parse_args()

    if args.schema == "-":
        schema = json.load(sys.stdin)
    else:
        with Path(args.schema).open(encoding="utf-8") as f:
            schema = json.load(f)

    table = schema["table"]
    sql = build_create_sql(schema, if_not_exists=args.if_not_exists)
    print("```sql")
    print(sql)
    print("```")

    if args.print_sql_only:
        return 0

    config_path = Path(args.config)
    if not config_path.is_file():
        print(f"설정 파일이 없습니다: {config_path}", file=sys.stderr)
        return 2

    databases = load_all_databases(config_path)
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, len(databases))) as pool:
        futures = {pool.submit(run_on_db, db, sql): db for db in databases}
        for fut in as_completed(futures):
            results.append(fut.result())

    results.sort(key=lambda r: (0 if r["debug"] else 1, r["host"], r["name"]))
    print_results(results)

    source = pick_source_db(results, databases)
    if source is None:
        print("모든 서버에서 테이블 생성에 실패해 구조 문서를 저장하지 않습니다.", file=sys.stderr)
        return 1

    try:
        structure_md = fetch_structure_markdown(source, table)
        actual_create = fetch_show_create_table(source, table)
    except RuntimeError as exc:
        print(f"구조 조회 실패: {exc}", file=sys.stderr)
        return 1

    print("\n## 실제 테이블 구조\n")
    print(structure_md)
    print("\n## CREATE TABLE\n")
    print("```sql")
    print(actual_create)
    print("```")

    doc_path = write_database_doc(
        table=table,
        structure_md=structure_md,
        create_sql=actual_create,
        out_dir=Path(args.docs_dir),
    )
    print(f"\n문서 저장: {doc_path}")

    if any(not r["ok"] for r in results):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
