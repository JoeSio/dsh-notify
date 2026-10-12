# DSH bundle checklist

Use when packaging a new plugin or diagnosing install failures.

## Authoring

- [ ] Module exports `apply` (and `name` if useful)
- [ ] Slash commands use `inject = ['commands']` + `ctx.commands.register` (not optional `get`)
- [ ] Session history via `snapshotEvents()` — never rely on removed `Session.events`
- [ ] `package.json` has `"type": "module"` and correct `main`
- [ ] `package.json` has `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
- [ ] `cordis.patch.yml` inserts a row whose `name` equals the package `name`
- [ ] `files` includes both the entry module and every patch YAML
- [ ] Runtime deps listed under `dependencies`; plugin checkout installed once

## Install

- [ ] Target profile chosen (`web` / `desktop` / …) — Desktop app ≠ `web`
- [ ] `dsh plugin --profile <p> add <path|github:…>`
- [ ] Layer confirmed: `web` → `--dump-config`; `desktop` → profile `package.json` bundles (CLI dump blocked)
- [ ] Fully quit and reopen Desktop after install or linked code changes
- [ ] Smoke-test (this repo: `/dsh-notify-test`, then a short agent turn for completion toast)

## Overrides

- [ ] User tweaks go in profile `cordis.patch.yml` by `id`
- [ ] Entire `config` restated (no deep merge)

## This repo (notify) extras

- [ ] `node_modules/node-notifier` present in plugin checkout
- [ ] `~/.dsh/dsh-notify.debug.log` shows `mounted` after restart
- [ ] Windows: Win+N / Notifications → **DSH** if toast path works but UI is quiet
- [ ] Details: [notify-troubleshoot.md](notify-troubleshoot.md)
