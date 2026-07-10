# Copilot Instructions

## Code Standards
- Functions: single responsibility, ≤ 50 lines, ≤ 4 positional parameters, early returns, pure by default.
- Error handling: never silently swallow exceptions; every external call has a timeout; distinguish recoverable vs fatal errors.
- Naming: reveal intent, no abbreviations (except standard acronyms), boolean prefix (is/has/should/can).
- Comments: explain "why", not "what"; keep comments in sync with code changes.
- Data: prefer immutability; no magic values; validate at system boundaries.

## Testing
- Every public API must have tests. Line coverage ≥ 80%.
- Test edge cases: empty/null/zero, boundary values, error paths, concurrency.
- One logical assertion per test; Arrange-Act-Assert structure; no conditionals in tests.
- Test naming: `should_<expected_behavior>_when_<condition>`.
- No flaky tests; no sleep() in tests.

## Project Constraints
- Architecture: separation of concerns; dependencies flow inward; no circular dependencies; side effects at edges.
- Configuration: env-var driven; no secrets in code; sensible defaults.
- Logging: structured (JSON); ERROR/WARN/INFO/DEBUG levels with clear contracts.
- Database: reversible migrations; no sensitive data in logs; queries must have LIMIT.
- Version control: Conventional Commits; one logical change per commit; PR descriptions required.
- Performance: timeouts on all external calls; retry with backoff; no N+1 queries.
- API: version from day one; idempotent writes; consistent error format; pagination on all list endpoints.
