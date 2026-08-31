# Completed and tested

Last updated: 2026-08-31

This is the completed-work ledger for the current session. An item belongs here
only after implementation and its stated verification are complete. Detailed
design notes and exact test results remain in the linked records.

## Behaviour-preserving refactor and artwork reliability

- [x] Corrected the pre-existing management API URL expectation failure and
  consolidated shared HTTP request mechanics without changing domain errors.
- [x] Decomposed application orchestration, playback presentation, persistence,
  polling, diagnostics, HLS policy, subtitle selection and styles into focused
  units while preserving current behaviour.
- [x] Added characterization and regression coverage around high-risk route,
  queue, runtime, polling, HLS, subtitle and artwork mechanics.
- [x] Retained one eagerly loaded application bundle with no `React.lazy`,
  dynamic module imports, route splitting or deferred feature chunks.
- [x] Consolidated and preloaded the canonical logo while retaining viewport
  lazy loading for ordinary catalogue artwork.
- [x] Hardened intermittent poster loading with longer bounded transient
  retries, invalid-response rejection, cache eviction and bounded browser
  decode recovery.
- [x] Passed 189/189 tests, TypeScript typechecking, modern and Samsung/Tizen
  production builds, and `git diff --check`.

Evidence: [refactor and artwork reliability record](2026-08-31-refactor-and-artwork-reliability.md)
