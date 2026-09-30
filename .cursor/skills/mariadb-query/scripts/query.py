#!/usr/bin/env python3
"""Run SQL using go/dev_secret/config.json. SELECT-like results print as a markdown table."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


RESULT_PREFIX = re.compile(
    r"^\s*(WITH\b|SELECT\b|SHOW\b|DESCRIBE\b|DESC\b|EXPLAIN\b|CHECK\b|ANALYZE\b)",
    re.IGNORECASE | re.DOTALL,
)


def workspace_root() -> Path:
    here = Path(__file__).resolve()
    # .cursor/skills/mariadb-query/scripts/query.py -> workspace root
    return here.parents[4]


def load_config(config_path: Path, *, debug: bool = True) -> dict:
    with config_path.open(encoding="utf-8") as f:
        cfg = json.load(f)

    entries = cfg.get("databases")
    if not isinstance(entries, list) or not entries:
        legacy = cfg.get("database")
        if isinstance(legacy, dict):
            entries = [legacy]
        else:
            raise SystemExit(f"config에 databases 섹션이 없습니다: {config_path}")

    selected = None
    for item in entries:
        if not isinstance(item, dict):
            continue
        if bool(item.get("debug", False)) == debug:
            selected = item
            break
    if selected is None:
        raise SystemExit(f"debug={debug} 인 데이터베이스 설정을 찾을 수 없습니다: {config_path}")

    required = ("host", "port", "user", "password", "name")
    missing = [k for k in required if k not in selected]
    if missing:
        raise SystemExit(f"database 설정 누락: {', '.join(missing)}")
    return selected


def is_result_query(sql: str) -> bool:
    stripped = sql.strip().rstrip(";").strip()
    if not stripped:
        return False
    # Use last statement if multiple are provided
    parts = [p.strip() for p in stripped.split(";") if p.strip()]
    last = parts[-1] if parts else stripped
    return bool(RESULT_PREFIX.match(last))


def run_mysql(db: dict, sql: str, batch: bool) -> subprocess.CompletedProcess[str]:
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
        cmd.extend(["--batch", "--raw"])
    else:
        cmd.append("--table")
    cmd.extend(["-e", sql])
    return subprocess.run(cmd, capture_output=True, text=True)


def tsv_to_markdown(tsv: str) -> str:
    lines = [ln for ln in tsv.splitlines() if ln != ""]
    if not lines:
        return "_결과 없음 (0 rows)_"

    rows = [line.split("\t") for line in lines]
    header = rows[0]
    body = rows[1:]

    def cell(v: str) -> str:
        if v == "NULL":
            return "NULL"
        return v.replace("|", "\\|").replace("\n", " ")

    out = [
        "| " + " | ".join(cell(h) for h in header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in body:
        # pad short rows
        padded = row + [""] * (len(header) - len(row))
        out.append("| " + " | ".join(cell(c) for c in padded[: len(header)]) + " |")
    out.append(f"\n_{len(body)} row(s)_")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run MariaDB/MySQL SQL via project config.json")
    parser.add_argument(
        "--config",
        default=str(workspace_root() / "go" / "dev_secret" / "config.json"),
        help="Path to config.json (default: go/dev_secret/config.json)",
    )
    parser.add_argument(
        "--debug",
        dest="debug",
        action="store_true",
        default=True,
        help="Use databases[].debug=true (default for Cursor)",
    )
    parser.add_argument(
        "--prod",
        dest="debug",
        action="store_false",
        help="Use databases[].debug=false",
    )
    parser.add_argument("sql", nargs="?", help="SQL statement (or pass via stdin)")
    args = parser.parse_args()

    sql = args.sql
    if not sql:
        sql = sys.stdin.read()
    if not sql or not sql.strip():
        print("SQL이 비어 있습니다.", file=sys.stderr)
        return 2

    config_path = Path(args.config)
    if not config_path.is_file():
        print(f"설정 파일이 없습니다: {config_path}", file=sys.stderr)
        return 2

    db = load_config(config_path, debug=args.debug)
    want_table = is_result_query(sql)
    result = run_mysql(db, sql, batch=want_table)

    # mysql prints password warning to stderr
    err = "\n".join(
        line
        for line in (result.stderr or "").splitlines()
        if "Using a password on the command line" not in line
    ).strip()

    if result.returncode != 0:
        if err:
            print(err, file=sys.stderr)
        else:
            print(result.stderr or "mysql 실행 실패", file=sys.stderr)
        return result.returncode

    stdout = result.stdout or ""
    if want_table:
        print(tsv_to_markdown(stdout))
    else:
        text = stdout.strip()
        if text:
            print(text)
        else:
            print("OK (affected rows reported by server if any)")
        if err:
            print(err, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
