# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Book Library Manager — an Obsidian plugin that scans a local book directory, uses DeepSeek AI to auto-classify books with multiple tags, generates a knowledge graph via Obsidian's native graph + wikilinks, and lazily generates book summaries/chapter analyses on user click.

## Tech Stack

- **Platform:** Obsidian plugin (TypeScript + Obsidian API)
- **Build:** esbuild (bundled), tsc (type-check only)
- **Book parsing:** pdfjs-dist (PDF), adm-zip + regex (EPUB), native fs (TXT)
- **AI:** DeepSeek API (OpenAI-compatible `/v1/chat/completions`)
- **Settings:** Obsidian Plugin API (`loadData`/`saveData`)
- **No frontend framework, no database** — vanilla TS, Obsidian Vault as storage

## Commands

```bash
npm run build     # Type-check + production build → main.js
npm run dev       # Watch mode — auto-rebuild on changes
npx tsc --noEmit  # Type-check only, no emit
```

### POC Verification (standalone, no Obsidian required)

```bash
BOOK_DIR="/path/to/books" DEEPSEEK_KEY="sk-..." npx ts-node poc-verify.ts
```

## Architecture (5-layer)

```
UI Layer (main.ts, settings tab)
  → Business Logic (scanner.ts orchestrator)
    → File Processing (parser.ts — pdf/epub/txt)
    → AI Client (ai.ts — DeepSeek API, prompt management)
  → Data (models.ts — BookRecord, AITask, ScanCache, PluginSettings)
  → Obsidian Native APIs (Vault, Metadata, Workspace, Graph — zero custom rendering)
```

**Key decisions:**
- AI is **lazy by default** — tags auto-generated on scan (if enabled), but summaries/analyses only generated on user click
- Token minimization: only first 3 pages per book sent for classification, 500-char truncated snippet in prompts
- Dedup via SHA256 of first 64KB — fast even with thousands of files
- All data in Obsidian's native `data.json` — no external database

## Source Layout

```
main.ts                Plugin entry, settings tab, command registration
src/models.ts          All TypeScript interfaces + defaults
src/scanner.ts         Directory walk, file hashing, dedup
src/parser.ts          PDF/EPUB/TXT text extraction
src/ai.ts              DeepSeek API client, prompt templates, token estimation
poc-verify.ts          Standalone POC runner (no Obsidian needed)
```

---

## Code Standards

### Functions & Methods

- **Single responsibility**: A function does exactly one thing, named after what it does. If the name needs "and" or "or", split it.
- **Length limit**: Functions/methods ≤ 50 lines. If longer, extract private helpers.
- **Parameters**: ≤ 4 positional parameters. Beyond that, use a structured input object (struct/dict/options bag). Boolean parameters are a smell — consider two functions or an enum instead.
- **Early return**: Use guard clauses at the top; avoid nested `if/else` beyond 2 levels. The happy path should run at the left margin.
- **Pure by default**: Functions that compute values should be pure (no side effects, no I/O). Side effects (DB writes, network calls, file I/O) belong in dedicated "action" functions whose name makes the effect obvious (e.g., `saveUser`, `sendNotification`, `writeConfig`).

### Error Handling

- **Fail loudly**: Never silently swallow exceptions. If you catch, either handle it fully (retry, fallback, recovery) or re-throw with context.
- **Error context**: Every error message must include enough context to debug without re-running: which entity, what operation, what input. `"User not found"` is insufficient; `"User not found: id=abc123, source=PostgreSQL.users"` is useful.
- **At system boundaries**: Every external call (HTTP, DB, file I/O, message queue) must have a timeout. Every timeout is a handled error with a fallback or a clear propagation path.
- **Distinguish recoverable from fatal**: Recoverable errors (network timeouts, temporary locks) get retries with backoff. Fatal errors (schema mismatch, auth failure) fail immediately with a clear message.

### Naming

- **Reveal intent**: A name answers "what does this do" or "what is this for", not "how is it implemented". `calculateOverdueFee` not `processData`. `usersByEmail` not `userMap`.
- **No abbreviations**: `getUserById`, not `getUsrById`. Exception: domain-standard acronyms (URL, JSON, HTML, ID).
- **Boolean variables**: Prefixed with `is`, `has`, `should`, `can`. `isActive`, `hasPermission`, `shouldRetry`.

### Comments

- **Why, not what**: Comments explain the reason behind non-obvious logic, not what the code does. Code shows what; comments explain why.
- **No zombie comments**: When updating code, update or remove nearby comments. A comment that contradicts the code is worse than no comment.

### Data & State

- **Immutability preference**: Default to immutable data structures. When mutation is necessary, isolate it to a single, clearly named scope.
- **No magic values**: Every literal with business meaning gets a named constant at the top of its scope. `const MAX_RETRY_COUNT = 3` not `if (retry > 3)`.
- **Validate at the edge**: Validate all external input at system boundaries (API handlers, CLI parsers, message consumers). Internal code operates on trusted, validated data.

---

## Testing Requirements

### Core Principle

**测试的真正目的是验证核心流程，避免低级 bug，不是为了刷覆盖率数字。**
- 优先测试核心业务逻辑（scanner、parser、ai-client、queue-service），覆盖率不强制
- 胶水代码（commands、views、简单 CRUD wrapper）不做无意义的 mock 测试
- 覆盖阈值设为全局 60% 即可，核心模块自然达到 80%+
- 严禁为了覆盖率数字写无效测试

### Coverage & Scope

- **Every public API must have tests**: Every exported function, method, endpoint, or CLI command has at least one test. A public API without a test is a bug.
- **Edge cases are required, not optional**: Every test suite covers at minimum:
  - Empty / null / zero / blank input
  - Boundary values (just above and just below a limit)
  - Error paths (what happens when the dependency fails)
  - Concurrent access scenarios for shared state (if applicable)

### Test Quality

- **One logical assertion per test**: One behavior verified per test case. Multiple assertions on the same logical outcome are fine; asserting unrelated things in one test is not.
- **Arrange-Act-Assert**: Every test has three clearly separated blocks. No assertions mixed with setup.
- **Test independence**: Tests must not depend on execution order. No shared mutable state between tests. Each test sets up its own world.
- **No logic in tests**: Conditionals (`if`/`else`, `switch`) and loops in test bodies indicate the test is testing too many things or the code under test needs refactoring.
- **Test naming**: `should_<expected_behavior>_when_<condition>`. Examples:
  - `should_return_active_users_when_filter_is_active`
  - `should_throw_validation_error_when_email_is_missing`
  - `should_return_empty_list_when_no_results_match`

### Test Types

- **Unit tests**: Cover business logic in isolation. External dependencies are mocked. Fast (≤ 10ms each).
- **Integration tests**: Cover the interaction between your code and a real external system (database, API, file system). Use test containers or embedded instances, not production services.
- **No flaky tests**: Tests that sometimes pass and sometimes fail without code changes must be fixed or removed. No `sleep()` in tests — use polling with deadlines, event-based waiting, or dependency injection of time.

---

## Project Constraints

### Architecture

- **Separation of concerns**: Business logic never lives in UI code, API handlers, or database access layer. These layers adapt between the outside world and the core domain.
- **Dependency direction**: Dependencies flow inward. Domain/business logic depends on nothing external. Infrastructure depends on domain, not the reverse. UI depends on application layer, not directly on infrastructure.
- **No circular dependencies**: Import/dependency graph must be a DAG. If module A imports module B, B must not import A (directly or transitively).
- **Side effects at the edges**: All I/O, network calls, and system interactions happen at the outermost layer. Core logic is pure and testable without mocks.

### Configuration

- **Environment-variable driven**: All environment-specific values (URLs, credentials, feature flags, timeouts) come from environment variables or a typed config system — never hardcoded.
- **No secrets in code**: No API keys, passwords, tokens, or connection strings in source. Use a secrets manager or env vars. If a secret appears in code, treat it as compromised.
- **Sensible defaults with overrides**: Every config value has a sensible default for development. Production overrides are explicit.

### Logging & Observability

- **Structured logging**: Logs are machine-parseable (JSON). Every log entry includes at minimum: timestamp, level, message, correlation ID (trace ID).
- **Log levels have contracts**:
  - `ERROR` — something is broken and needs human attention now
  - `WARN` — something unexpected but the system recovered or degraded gracefully
  - `INFO` — key business events (user signup, order placed, payment processed)
  - `DEBUG` — developer diagnostics, enabled in development, off in production
- **Every log is actionable**: A stranger on call should understand what happened and what to do from the log message alone.

### Data & Persistence

- **Migrations are reversible**: Every schema migration has a corresponding down/rollback. If a migration cannot be rolled back (destructive), it's explicitly flagged and requires manual approval.
- **No sensitive data in logs or errors**: Passwords, tokens, PII — never logged, never in error messages, never in stack traces.
- **Database queries have limits**: Every query without a `LIMIT` is a bug waiting to happen. Default page size ≤ 100 rows.

### Version Control

- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`. The subject line is imperative and ≤ 72 characters.
- **One commit = one logical change**: A commit doesn't mix a refactor with a feature, or a feature with a bug fix. Cherry-pickable without dragging in unrelated changes.
- **PR requirements**: Every PR description includes: what changed, why, how to test, and screenshots/logs for UI or behavioral changes.

### Performance & Resilience

- **External calls have timeouts**: Every HTTP request, DB query, or RPC call has an explicit timeout. No timeout = the system can hang indefinitely.
- **Retry with backoff**: Transient failures get automatic retries with exponential backoff and jitter. Set a maximum retry count.
- **No N+1 queries**: When fetching related data, batch or join. If a loop body makes a database query, it's almost certainly wrong.
- **Fail open vs. fail closed**: Decide explicitly for each feature whether a dependency failure degrades gracefully (fail open — e.g., recommendations are empty) or blocks the operation (fail closed — e.g., payment must succeed). Document the decision.

### API Design (when applicable)

- **Version from day one**: APIs include a version prefix (`/v1/`, `/v2/`). Changing a response field is a new version.
- **Idempotency for mutating operations**: `PUT` and `DELETE` are idempotent. `POST` that creates resources uses idempotency keys for retry safety.
- **Consistent error responses**: All errors follow the same structure: `{ "error": { "code": "RESOURCE_NOT_FOUND", "message": "...", "details": {...} } }`.
- **Pagination for all list endpoints**: No endpoint returns unbounded collections. Every list response includes pagination metadata.

---

## Debugging Rules

**When fixing a bug, do not cut corners:**

1. **Find the root cause, not the symptom** — Trace the full call chain. Every bug has a specific line or logic flaw that caused it. "It works now" without understanding why is unacceptable.
2. **Fix it completely** — A partial fix that leaves edge cases broken is worse than no fix. Consider all scenarios and code paths affected by the change.
3. **Tests must pass** — Run the full test suite. If a test breaks, fix it. Never skip or disable a failing test to "get the build green".
4. **Ask when uncertain** — If there are multiple possible fixes or you're unsure about the correct approach, pause and ask the user before proceeding. Guessing wastes time and creates new bugs.
5. **Don't break existing functionality** — A bug fix for one thing must not regress another. Check related features manually and via tests.
6. **Be thorough** — Fixing the same bug twice because the first attempt was shallow is unacceptable. Take the time to get it right the first time.

---

## When Writing Code in This Repository

Before writing any code, check:
1. Does this function do exactly one thing?
2. Where are the tests? (Write them first or alongside — never after.)
3. Where is the error handling? (Every external call; every edge case.)
4. Is there any hardcoded configuration or magic value?
5. Could this fail at 3 AM and would the on-call engineer understand the log?
