# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.6] - 2026-11-13

### Added
- Rich-based console logging for executed commands (`bridge/rich-log.py`):
  syntax-highlighted panels and colored exit status. Falls back to plain
  text logs when Rich is unavailable.
- Optional local virtualenv setup for Rich, documented in the README.
- Configurable send cooldown in the extension popup (0-180 s).
- Bridge prints every command it runs and its exit code to the console.

### Changed
- Browser launch on startup is platform-aware: `cmd.exe start` on Windows,
  `open` on macOS, `xdg-open` on Linux (override with `DS_PWSH_OPEN_CMD`).
- Bridge code split into `config.js`, `executor.js`, `logger.js`,
  `browser.js` and `server.js`; `host.js` remains the entry point.
- The bridge no longer holds `/execute` responses during the send cooldown;
  the delay is applied in the browser.

### Fixed
- `host.js` previously blocked `/execute` for the configured cooldown,
  delaying command results.

## [1.1.3] - 2026-11-13

### Added
- Current-chat deletion action ("Закончить сессию").
- Confirm-before-run dialog and automatic execution toggle.

## [1.0.0] - 2026-11-13

### Added
- Initial release: Chrome extension that runs `bash`/`pwsh` code blocks from
  DeepSeek through a local Node.js bridge.

