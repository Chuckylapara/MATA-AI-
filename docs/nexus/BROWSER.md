# NEXUS — Browser agent

**Status: planned (Phase 10).** Listed as `planned` in the agent registry; never offered to the model.

Design: Playwright (Apache-2.0) in an isolated server-side context, only for sites that permit
automation and have no API. Actions: open, click, type, read, fill forms, download/upload
permitted files. Form submission, purchases and account changes are HIGH risk (confirmation).
No CAPTCHA solving, no login-wall or paywall bypass, no use of the user's real browser cookies
unless they explicitly connect an account. Enable later with `NEXUS_BROWSER_ENABLED=1`.
