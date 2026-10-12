---
name: dsh-plugin-bundle
description: >-
  Author, package, install, and debug DeepSeek Harness (dsh) plugins as
  installable bundles. Use whenever this repo or any dsh plugin work mentions
  dsh.bundle, cordis.patch.yml, dsh plugin add/remove, "declares no bundle",
  profile bundles, plugin install failures, Cordis apply/inject, packaging a
  local/git plugin for web/desktop profiles, Desktop notifications not firing,
  /dsh-notify-test, Session.events / snapshotEvents, or Windows snoretoast —
  even if the user only says "install the plugin" or "fix dsh load". Prefer
  this over re-fetching DSH docs. For LLM provider/credential/reasoning-effort
  config, use the personal dsh-configuration skill instead.
---

# DSH plugin bundles

## Core model (do not rediscover)

| Concept | Manifest | Answers |
| --- | --- | --- |
| **Plugin module** | JS/TS exporting `apply(ctx, config?)` (+ optional `name`, `inject`) | What code runs |
| **Bundle** | npm package with `dsh.bundle.patch` → patch YAML | What config layer this package contributes |
| **Profile** | `$DSH_HOME/profiles/<name>` with `dsh.profile.bundles` | Which bundles compose a runnable setup |

A package **without** `dsh.bundle` can still be linked as a dependency, but `dsh plugin add` will **not** activate a layer. Typical error:

```text
This package declares no bundle, so it cannot be installed as a plugin: <name> declares no dsh.bundle.
```

**Fix:** add `dsh.bundle` + ship `cordis.patch.yml` that inserts the plugin row.

## Minimal installable layout

```
<plugin>/
├── package.json        # name, type:module, main, files, dsh.bundle
├── cordis.patch.yml    # insert row(s); name = package name for resolution
└── index.js            # export { apply, name, inject? } (or default object/class)
```

### package.json (required keys)

```json
{
  "name": "dsh-notify",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- Put **both** the entry module and the patch file in `files`, or pack/publish drops the layer.
- `patch` may be a string or an ordered list of YAML files (applied as one layer).
- Third-party runtime deps → `dependencies`. Host-shared dsh packages → `peerDependencies` + `devDependencies` (host copy wins at runtime).

### cordis.patch.yml

```yaml
- insert:
    - id: dsh-notify
      name: dsh-notify
```

- Row `name` is the **npm package name** (Node resolution), not a filesystem path.
- Absolute/relative TS paths are for `--patch` overlays during development, not for installable bundles.
- Optional `config:` on the row is passed to `apply(ctx, config)`.

### Plugin module shape

```js
export const name = 'dsh-notify'
export const inject = ['commands'] // wait for services before apply when registering slash commands
export function apply(ctx, config) {
  // register via ctx; cleanup is automatic; use ctx.effect(function* () { yield disposer }) when needed
}
```

Object/class forms are also valid; function form is enough for most plugins.

**`inject` vs optional `ctx.get`:** for slash commands, prefer `inject = ['commands']` and `ctx.commands.register(...)`. Optional `ctx.get('commands')` can be undefined at apply time depending on load order, so the test command never registers.

## Install / verify workflow

1. In the plugin checkout: `pnpm install` (or npm). **Link installs do not install the plugin's own deps for you.**
2. Add to a profile:
   ```bash
   dsh plugin --profile desktop add .
   # or: dsh plugin --profile web add github:JoeSio/dsh-notify
   # Desktop GUI = profile "desktop"; CLI web UI = "web" (separate installs)
   ```
3. Confirm the layer:
   ```bash
   dsh --profile web --dump-config   # look for "# == <package-name>"
   # desktop: CLI refuses --dump-config ("managed exclusively by the Electron application").
   # Verify ~/.dsh/profiles/desktop/package.json bundles + fully quit/reopen Desktop instead.
   ```
4. Remove: `dsh plugin --profile <p> remove <package-name>`

Git installs of TypeScript packages need a self-contained `prepare` build + user `allowBuilds` in the profile's `pnpm-workspace.yaml` (pnpm ≥10). Prefer shipping built JS (this repo) or a tarball to avoid that.

After changing linked plugin code: **fully quit** DeepSeek Harness (including tray), then reopen. Window reload does not remount the host plugin tree.

## Layer order (later wins per row)

1. Each bundle in `dsh.profile.bundles` (list order)
2. Profile `cordis.patch.yml`
3. `$DSH_HOME/cordis.patch.yml`
4. CLI `--patch` overlays (argv order)

**Config semantics:** a patch's `config` **replaces** the whole config object for that `id` — not a deep merge. User overrides in the profile patch must restate every key they want kept.

## User config override (after bundle install)

Do **not** re-`insert` the same id unless intentional. Override by id in the profile patch:

```yaml
- id: dsh-notify
  name: dsh-notify
  config:
    enabled: true
    # ...restated keys...
```

`id` selects the row; optional `name` must match if present.

## Session history reads (host API)

Current DSH **removed** `Session.events`. Do **not** read `agent.session.events` for turn outcomes — it is always undefined and silently breaks completion logic.

Use `agent.session.snapshotEvents()` (deprecated but still present; optional fallback to `.events` for older hosts). See [notify-troubleshoot.md](references/notify-troubleshoot.md).

## This repo (dsh-notify)

- Package / Cordis name: `dsh-notify`
- Entry: `index.js` (ESM); `inject: ['commands']`; uses `node-notifier` (Windows → snoretoast)
- Bundle patch: `cordis.patch.yml` inserts `id: dsh-notify`
- Smoke: `/dsh-notify-test`; diagnostics: `~/.dsh/dsh-notify.debug.log`
- Fork remote: `origin` = `https://github.com/JoeSio/dsh-notify.git`; `upstream` = haytham818
- Git author for commits: repo-local `JoeSio <joe_sio@hotmail.com>` (see `.cursor/rules/git-author.mdc`)

Detailed Windows / completion debugging: [references/notify-troubleshoot.md](references/notify-troubleshoot.md).

## Symptom → fix

| Symptom | Fix |
| --- | --- |
| `declares no dsh.bundle` | Add `dsh.bundle.patch` + patch file; include patch in `files` |
| Plugin linked but never mounts | Bundle missing, or row `name` wrong, or wrong profile (`web` vs `desktop`) |
| Config change "did nothing" | Wrong profile; patch `id` typo (warn-only skip); or deep-merge assumption |
| Notifications / deps missing at runtime | Run install inside the plugin checkout after link |
| TS plugin empty after `github:` add | Need `prepare` + `allowBuilds`, or ship built artifacts |
| `/dsh-notify-test` works, task-complete never notifies | Reading `session.events` — switch to `snapshotEvents()` |
| Desktop `--dump-config` errors | Expected; inspect profile `package.json` / quit+reopen Desktop |
| No host console for `[dsh-notify]` logs | Read `~/.dsh/dsh-notify.debug.log`; fully restart after code changes |
| Windows: toast API works, user sees nothing | Check Win+N and Settings → Notifications → **DSH** |

## Official docs (fetch only if skill is insufficient)

- First plugin / `apply`: https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/
- Bundle + `dsh plugin add`: https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish
- Architecture (profile/bundle): https://deepseek-harness.github.io/deepseek-harness/en/reference/

Do not re-research these on every session unless versions or errors contradict this skill — then update this skill.
