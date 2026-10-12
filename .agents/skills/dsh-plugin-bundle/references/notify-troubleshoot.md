# dsh-notify runtime troubleshoot

Use when Desktop notifications fail, `/dsh-notify-test` works but completion does not, or Windows 11 shows no toast.

## Profiles

| App | Profile | Notes |
| --- | --- | --- |
| DeepSeek Harness Desktop (Electron) | `desktop` | Reserved; CLI `--dump-config` for `desktop` is rejected |
| CLI `dsh web` | `web` | Separate bundles list — installing on `web` does not affect Desktop |

Confirm install in `~/.dsh/profiles/desktop/package.json` → `dsh.profile.bundles` includes `dsh-notify` and dependency is `link:` / installed.

Desktop host must be **fully quit** (tray too) after plugin code or bundle changes; window reload is not enough.

## Session event log (completion notify)

Current DSH **removed** `Session.events`. Synchronous history is via deprecated:

- `session.snapshotEvents()`
- `session.eventAt(seq)`
- `session.ownEvents()`

**This plugin must use `snapshotEvents()`** (with optional `.events` fallback for older hosts). Reading `.events` alone makes `lastTurnReason` always `undefined` → completion/error notifies silently skip while `/dsh-notify-test` still works.

Completion path: `agent/status` → `status === 'idle'` → last `turn/end` reason `completed` | `max-tokens` | `error`. Aborted/blocked: no notify.

## Commands

Register slash commands with `export const inject = ['commands']` and `ctx.commands.register(...)`. Optional `ctx.get('commands')` can miss the registry depending on load order.

## Desktop host diagnostics

Host stdout/stderr are not a user-visible console. This plugin appends to:

```text
~/.dsh/dsh-notify.debug.log
```

| Log line | Meaning |
| --- | --- |
| `mounting` / `mounted listeners` | `apply()` ran after restart |
| `notify title=...` / `notify-ok` | Toast path invoked |
| `status-idle skip no turn/end` | Event log read failed (classic `.events` bug) |
| `status-idle skip non-root` | `rootsOnly` filtered the agent |
| (file missing after restart) | Plugin never mounted — wrong profile / bundle skip |

## Windows toast path

- Backend: `node-notifier` → bundled `snoretoast-*.exe` (`appName` → snoretoast `-appID`)
- Link install: run `pnpm install` / `npm install` **inside the plugin checkout** so `node_modules/node-notifier` exists
- Manual smoke (outside dsh): run snoretoast or a tiny `node-notifier` script; registry/app id appears as `DSH`
- User check: **Win+N** notification center; Settings → Notifications → **DSH** (banner/toast should be on)
- snoretoast exit code `3` = timed out waiting for click = success
- Toast **click** → plugin opens exact `dsh://open` (focus only; no `?session=` until harness forwards it). Debug: `notify-activate → focus-desktop` then `focus-desktop-ok`

Compose-check Desktop profile without `--dump-config` (blocked): load `@deepseek-ai/dsh-app-boot` via Electron-as-Node against `~/.dsh/profiles/desktop` + install anchor under `app.asar`, or inspect `package.json` bundles + `skippedBundles` at host start.

## Verify order

1. Fully quit Desktop → reopen  
2. Confirm `~/.dsh/dsh-notify.debug.log` has a fresh `mounted` line  
3. `/dsh-notify-test` → toast + `notify-ok` in debug log  
4. Click the toast → Desktop focuses; debug has `focus-desktop-ok`  
5. Short agent turn → `DSH · 任务完成` + debug log without `skip no turn/end`
