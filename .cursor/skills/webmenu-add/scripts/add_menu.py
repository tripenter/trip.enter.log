#!/usr/bin/env python3
"""Insert a WebMenu row using go/dev_secret/config.json (debug DB by default)."""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
from pathlib import Path


def workspace_root() -> Path:
    # .cursor/skills/webmenu-add/scripts/add_menu.py -> workspace root
    return Path(__file__).resolve().parents[4]


def safe_web_folder(folder: str) -> Path:
    """Resolve web/<folder> under workspace; reject path traversal."""
    raw = folder.strip().strip("/\\")
    if not raw:
        raise ValueError("folder가 비어 있습니다")
    if re.search(r"(^|/|\\)\.\.(/|\\|$)", raw) or raw.startswith(("..", "/", "\\")):
        raise ValueError(f"허용되지 않는 폴더 경로: {folder!r}")
    if Path(raw).is_absolute():
        raise ValueError(f"절대 경로는 사용할 수 없습니다: {folder!r}")

    root = workspace_root() / "web"
    target = (root / raw).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"web/ 밖의 경로입니다: {folder!r}") from exc
    return target


def scaffold_child_page(folder: str, title: str) -> Path:
    """Create web/<WM_Folder>/index.html with dynamic top menu + menu title."""
    target_dir = safe_web_folder(folder)
    target_dir.mkdir(parents=True, exist_ok=True)
    page = target_dir / "index.html"
    safe_title = html.escape(title, quote=True)
    depth = len(Path(folder.strip().strip("/\\")).parts)
    asset_prefix = "../" * depth
    page.write_text(
        f"""<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{safe_title}</title>
    <link rel="stylesheet" href="{asset_prefix}css/intro.css" />
  </head>
  <body>
    <header class="site-nav" role="banner">
      <nav class="nav-inner" aria-label="주메뉴">
        <a class="nav-brand font-display" href="{asset_prefix}index.html">트립엔터</a>
        <div class="nav-dynamic" data-dynamic-menu aria-live="polite"></div>
      </nav>
    </header>
    <main style="padding: 5rem 1.25rem 2rem">
      <h1 class="font-display">{safe_title}</h1>
    </main>
    <script src="{asset_prefix}js/menu.js" defer></script>
  </body>
</html>
""",
        encoding="utf-8",
    )
    return page


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


def mysql_escape(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\x00", "\\0")
    )


def run_mysql(db: dict, sql: str, *, batch: bool = True) -> subprocess.CompletedProcess[str]:
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
        cmd.extend(["--batch", "--raw", "--skip-column-names"])
    cmd.extend(["-e", sql])
    return subprocess.run(cmd, capture_output=True, text=True)


def clean_err(stderr: str | None) -> str:
    return "\n".join(
        line
        for line in (stderr or "").splitlines()
        if "Using a password on the command line" not in line
    ).strip()


def parent_clause(parent_id: int | None) -> str:
    if parent_id is None:
        return "WM_ParentId IS NULL"
    return f"WM_ParentId = {int(parent_id)}"


def fetch_siblings(db: dict, parent_id: int | None) -> list[tuple[int, int, str]]:
    sql = f"""
SELECT WM_Id, WM_SortOrder, WM_Title
FROM WebMenu
WHERE {parent_clause(parent_id)}
ORDER BY WM_SortOrder, WM_Id;
"""
    result = run_mysql(db, sql)
    err = clean_err(result.stderr)
    if result.returncode != 0:
        raise SystemExit(err or "형제 메뉴 조회 실패")

    rows: list[tuple[int, int, str]] = []
    for line in (result.stdout or "").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        rows.append((int(parts[0]), int(parts[1]), parts[2]))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Insert WebMenu row via project config.json")
    parser.add_argument(
        "--config",
        default=str(workspace_root() / "go" / "dev_secret" / "config.json"),
        help="Path to config.json",
    )
    parser.add_argument("--parent-id", type=int, default=None, help="WM_ParentId (omit for top-level)")
    parser.add_argument("--folder", default=None, help="WM_Folder (omit for NULL)")
    parser.add_argument("--title", required=True, help="WM_Title")
    parser.add_argument(
        "--after",
        type=int,
        required=True,
        help="Insert after this 1-based index among siblings (0 = first)",
    )
    parser.add_argument("--active", type=int, required=True, choices=(0, 1), help="WM_IsActive")
    parser.add_argument(
        "--debug",
        dest="debug",
        action="store_true",
        default=True,
        help="Use databases[].debug=true (default)",
    )
    parser.add_argument(
        "--prod",
        dest="debug",
        action="store_false",
        help="Use databases[].debug=false",
    )
    args = parser.parse_args()

    if args.after < 0:
        print("--after 는 0 이상이어야 합니다.", file=sys.stderr)
        return 2

    config_path = Path(args.config)
    if not config_path.is_file():
        print(f"설정 파일이 없습니다: {config_path}", file=sys.stderr)
        return 2

    db = load_config(config_path, debug=args.debug)
    siblings = fetch_siblings(db, args.parent_id)

    if not siblings:
        new_sort = 1
    else:
        if args.after > len(siblings):
            print(
                f"--after={args.after} 는 현재 형제 수({len(siblings)})를 넘을 수 없습니다.",
                file=sys.stderr,
            )
            return 2
        new_sort = args.after + 1

    parent_sql = "NULL" if args.parent_id is None else str(int(args.parent_id))
    if args.folder is None or args.folder == "":
        folder_sql = "NULL"
    else:
        folder_sql = f"'{mysql_escape(args.folder)}'"
    title_sql = f"'{mysql_escape(args.title)}'"

    sql = f"""
START TRANSACTION;
UPDATE WebMenu
SET WM_SortOrder = WM_SortOrder + 1,
    WM_UpdatedAt = NOW()
WHERE {parent_clause(args.parent_id)}
  AND WM_SortOrder >= {new_sort};
INSERT INTO WebMenu (
  WM_ParentId, WM_Title, WM_Folder, WM_SortOrder, WM_IsActive, WM_CreatedAt, WM_UpdatedAt
) VALUES (
  {parent_sql}, {title_sql}, {folder_sql}, {new_sort}, {int(args.active)}, NOW(), NOW()
);
SELECT LAST_INSERT_ID() AS WM_Id, {new_sort} AS WM_SortOrder;
COMMIT;
"""

    result = run_mysql(db, sql, batch=True)
    err = clean_err(result.stderr)
    if result.returncode != 0:
        print(err or "INSERT 실패", file=sys.stderr)
        return result.returncode

    lines = [ln for ln in (result.stdout or "").splitlines() if ln.strip()]
    if not lines:
        print("OK (inserted, but LAST_INSERT_ID not returned)")
        return 0

    # Last non-empty line should be: <id>\t<sort>
    last = lines[-1].split("\t")
    wm_id = last[0] if last else "?"
    sort_order = last[1] if len(last) > 1 else str(new_sort)
    print(
        f"OK inserted WM_Id={wm_id} WM_SortOrder={sort_order} "
        f"WM_ParentId={args.parent_id if args.parent_id is not None else 'NULL'} "
        f"WM_Title={args.title!r} WM_Folder={args.folder!r} WM_IsActive={args.active}"
    )

    # 하위메뉴 + WM_Folder 있을 때 web/<folder>/index.html 생성
    if args.parent_id is not None and args.folder:
        try:
            page = scaffold_child_page(args.folder, args.title)
        except ValueError as exc:
            print(f"WARN web scaffold skipped: {exc}", file=sys.stderr)
            return 0
        rel = page.relative_to(workspace_root())
        print(f"OK scaffolded {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
