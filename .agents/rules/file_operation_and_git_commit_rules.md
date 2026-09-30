# Strict Rules for File Operations & Git Commits

## 1. File Operation Approval Rule (CRITICAL)
- BEFORE performing any file operation (create, modify, delete):
  - Must report to user: File path, File name, Action type (Create/Modify/Delete), Rationale.
  - Must ask for explicit user permission.
  - MUST NOT proceed without explicit user approval.

## 2. Mandatory Git Commit And Push After File Operations
- AFTER completing approved file operations:
  - If target files are INSIDE the active workspace root:
    1. Execute `git commit`.
    2. Then execute `./go/dev_secret/git_push.sh` to push the commit.
  - Exception: If files are OUTSIDE the active workspace root, perform file operation with user approval, but skip git commit and push.
  - Exception: If the changed files are ignored by `.gitignore` and nothing is staged for commit, skip commit and push and tell the user.

## 3. Git Commit Message Format (Strict Requirements)
- Message MUST be written in Korean summarizing user requirements (avoid listing raw technical English jargon).
- Format: `[<type>] <commit_reason_in_korean>`
- Commit Types (`<type>`):
  - `신규기능`: Added new features
  - `버그수정`: Fixed bugs
  - `문서작성`: Documentation work (README, *.md, code comments/docstrings)
  - `리팩토링`: Refactored code structure without feature changes
  - `스타일`: Formatting, semicolon fixes, minor style tweaks without logic changes
  - `테스트`: Added or updated test code
  - `환경설정`: Added, updated, or removed environment/package manager configs

## 4. REST API Routing Rule (CRITICAL)
- All REST API endpoints and routes MUST start with the `/rest` prefix (e.g. `/rest/ping`, `/rest/users`, `/rest/v1/...`).

## 5. Git Push & Pull Execution Rules (CRITICAL)
- After an approved workspace file operation commit, MUST push with `./go/dev_secret/git_push.sh`.
- When requested to `git push`, MUST execute `./go/dev_secret/git_push.sh`.
- When requested to `git pull`, MUST execute `./go/dev_secret/git_pull.sh`.
- Do not run plain `git push` / `git pull` for this repository's remote sync.