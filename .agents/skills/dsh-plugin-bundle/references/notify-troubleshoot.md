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

- Backend (Windows): WinRT toast via PowerShell — `activationType=protocol` `launch=dsh://open`, appID `com.dsh-notify.app` (snoretoast `-install "DSH Notify"` for Start Menu shortcut). Fallback: snoretoast display-only.
- Do **not** rely on snoretoast `-application` (Action Center never starts it) or pipe activate after banner timeout
- Link install: `pnpm/npm install` in plugin checkout; ship `scripts/`
- User check: **Win+N** → **DSH Notify**; debug `winrt-toast-ok shown`

Compose-check Desktop profile without `--dump-config` (blocked): load `@deepseek-ai/dsh-app-boot` via Electron-as-Node against `~/.dsh/profiles/desktop` + install anchor under `app.asar`, or inspect `package.json` bundles + `skippedBundles` at host start.

## Verify order

1. Fully quit Desktop → reopen  
2. Confirm `~/.dsh/dsh-notify.debug.log` has a fresh `mounted` line  
3. `/dsh-notify-test` → toast + `notify-ok` in debug log  
4. Click the toast → minimized Desktop focuses; Win+N source is **DSH Notify**  

5. Short agent turn → `DSH · 任务完成` + debug log without `skip no turn/end`
