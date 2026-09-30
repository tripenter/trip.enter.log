---
name: mariadb-query
description: >-
  Runs SQL against the project's MariaDB/MySQL using go/dev_secret/config.json.
  Use when the user asks to query MariaDB, MySQL, trip-enter DB, run SELECT/INSERT/UPDATE/DELETE,
  inspect tables, or show query results as a table.
---

# MariaDB Query

## When to use

Use this skill whenever the user wants to run SQL against the database defined in
`go/dev_secret/config.json` (host, port, user, password, database name).

## How to run

From the workspace root:

```bash
python3 .cursor/skills/mariadb-query/scripts/query.py "SQL HERE"
```

Multi-statement or complex SQL via stdin:

```bash
python3 .cursor/skills/mariadb-query/scripts/query.py <<'SQL'
SELECT * FROM some_table LIMIT 20;
SQL
```

Optional config path:

```bash
python3 .cursor/skills/mariadb-query/scripts/query.py --config go/dev_secret/config.json "SELECT 1"
```

## Agent workflow

1. Read this skill, then run `scripts/query.py` with the user's SQL.
2. Do **not** hardcode DB credentials in chat or scripts; always load from `config.json`.
3. Prefer `LIMIT` on exploratory `SELECT` unless the user asks for all rows.
4. Show the script stdout to the user as-is.
5. For result sets (`SELECT`, `SHOW`, `DESCRIBE`/`DESC`, `EXPLAIN`, `WITH ... SELECT`), the script prints a **markdown table**.
6. For write statements, the script prints affected row count / OK status.
7. Requires the `mysql` (or MariaDB) client on `PATH` (Homebrew: `mysql` / `mariadb`).

## Safety

- Do not run destructive SQL (`DROP`, `TRUNCATE`, mass `DELETE`/`UPDATE`) unless the user explicitly requested that exact action.
- Never commit `go/dev_secret/config.json` or print passwords.
