#!/usr/bin/env python3
"""Create a table on every database listed in go/dev_secret/config.json (in parallel)."""

from __future__ import annotations

import argparse
import json
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
    elif size is not None and size != "" and typ not in {"TEXT", "LONGTEXT", "MEDIUMTEXT", "TINYTEXT", "BLOB", "LONGBLOB", "JSON", "DATE", "DATETIME", "TIMESTAMP", "TIME", "YEAR", "BOOLEAN", "BOOL", "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT"}:
        # allow explicit size for uncommon types when provided
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


def run_on_db(db: dict[str, Any], sql: str) -> dict[str, Any]:
    label = {
        "debug": bool(db.get("debug", False)),
        "host": db["host"],
        "port": db["port"],
        "name": db["name"],
        "user": db["user"],
    }
    cmd = [
        "mysql",
        f"--host={db['host']}",
        f"--port={db['port']}",
        f"--user={db['user']}",
        f"--password={db['password']}",
        "--default-character-set=utf8mb4",
        db["name"],
        "-e",
        sql,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    err = "\n".join(
        line
        for line in (result.stderr or "").splitlines()
        if "Using a password on the command line" not in line
    ).strip()
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
    args = parser.parse_args()

    if args.schema == "-":
        schema = json.load(sys.stdin)
    else:
        with Path(args.schema).open(encoding="utf-8") as f:
            schema = json.load(f)

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

    # stable order: debug true first, then false, then host
    results.sort(key=lambda r: (0 if r["debug"] else 1, r["host"], r["name"]))
    print_results(results)

    if any(not r["ok"] for r in results):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
