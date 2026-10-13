---
name: dsh-notify-plugin
description: >-
  dsh-notify-specific runtime notes: Desktop notifications not firing,
  /dsh-notify-test, Session.events vs snapshotEvents, Windows WinRT/snoretoast
  toasts, debug log at ~/.dsh/dsh-notify.debug.log, Plugins page Language
  locale dropdown for this package. Use when working in the dsh-notify repo
  or debugging notify behavior. For generic bundle authoring, install,
  cordis.patch.yml, and Plugins config UI patterns, use the user-level
  dsh-plugin-bundle skill instead.
---

# dsh-notify (repo notes)

Generic bundle / install / Plugins UI: use the **user-level** `dsh-plugin-bundle` skill (`~/.agents/skills/dsh-plugin-bundle`). Do not re-copy that material here.

## This package

- Package / Cordis name: `dsh-notify` (entry id = package name)
- Entry: `index.js` (ESM); `inject: ['commands']`; exports `Config` (`locale` volatile `zh`|`en`); Windows → WinRT protocol toast (`dsh://open`); other OS → node-notifier
- Browser: `lib/client.js` → `plugins.bundle.config` key `dsh-notify` (Language / 通知语言 select)
- Deps: `node-notifier`, `@deepseek-ai/schemastery` (~3.18.4+)
- Bundle patch: `cordis.patch.yml` inserts `id: dsh-notify`
- Smoke: `/dsh-notify-test`; diagnostics: `~/.dsh/dsh-notify.debug.log`
- Fork remotes: see `git remote -v` (avoid machine-local absolute paths in docs)
- Git author for commits: repo-local config / `.cursor/rules/git-author.mdc`

## Notify-specific symptoms

| Symptom | Fix |
| --- | --- |
| `/dsh-notify-test` works, task-complete never notifies | Reading `session.events` — switch to `snapshotEvents()` |
| No host console for `[dsh-notify]` logs | Read `~/.dsh/dsh-notify.debug.log`; fully restart after code changes |
| Windows: toast API works, user sees nothing | Check Win+N and Settings → Notifications → **DSH Notify** |
| Windows: toast click does not focus Desktop | Use WinRT protocol toast (`launch=dsh://open`, appID `com.deepseek.dsh`); do not rely on snoretoast `-application` or app activation; fully quit/reopen after plugin change |
| Language dropdown missing after code change | Confirm `dsh.client` + `./client` export; `pnpm/npm install` in plugin; fully quit Desktop |

Detailed Windows / completion debugging: [references/notify-troubleshoot.md](references/notify-troubleshoot.md).

Notify install extras: [references/checklist.md](references/checklist.md).
