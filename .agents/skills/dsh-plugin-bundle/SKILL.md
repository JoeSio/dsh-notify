---
name: dsh-plugin-bundle
description: >-
  Author, package, install, and debug DeepSeek Harness (dsh) plugins as
  installable bundles. Use whenever this repo or any dsh plugin work mentions
  dsh.bundle, cordis.patch.yml, dsh plugin add/remove, "declares no bundle",
  profile bundles, plugin install failures, Cordis apply/inject, packaging a
  local/git plugin for web/desktop profiles, Desktop notifications not firing,
  /dsh-notify-test, Session.events / snapshotEvents, Windows snoretoast,
  Plugins page config UI, locale/language dropdown, Config.volatile,
  plugins.bundle.config, dsh.client, or lib/client.js — even if the user only
  says "install the plugin" or "fix dsh load". Prefer this over re-fetching
  DSH docs. For LLM provider/credential/reasoning-effort config, use the
  personal dsh-configuration skill instead. Prefer a local deepseek-harness
  checkout when available; otherwise use the official docs URLs below.
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
├── package.json        # name, type:module, main, files, dsh.bundle (+ optional dsh.client)
├── cordis.patch.yml    # insert row(s); name = package name for resolution
├── index.js            # export { apply, name, inject?, Config? }
└── lib/client.js       # optional browser half (Plugins page UI)
```

### package.json (required keys)

```json
{
  "name": "dsh-notify",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
  "files": ["index.js", "lib", "cordis.patch.yml"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-plugin-manager"
      ]
    }
  }
}
```

- Put the entry module, patch YAML, and (if present) `lib/` in `files`, or pack/publish drops them.
- `patch` may be a string or an ordered list of YAML files (applied as one layer).
- Third-party runtime deps → `dependencies`. Out-of-tree plugins that export a schemastery `Config` should depend on `@deepseek-ai/schemastery` **~3.18.4+** (needs `.volatile()`); do not assume the host copy is on the plugin's resolve path.
- Host-shared dsh packages used only via `ctx` → duck-type / `ctx.get`; avoid importing them as values from the host tree.

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

## Plugins page config UI (bundle detail)

The Desktop **Plugins → \<package\>** page (Uninstall, version badge, **Components N total · M running**) is owned by `dsh-client-ui-plugin-manager` inside the Electron app — **not** under `~/.dsh/profiles/*/node_modules`. Searching the profile tree for that package will miss.

**Config schema alone does not render controls on that page.** `autoGenerate` defaults to true on the Host describe payload, but there is no shipped auto-form consumer yet. A dropdown/field appears only when:

1. **Host** exports schemastery `Config` with editable fields marked `.volatile()` (ordinary fields stay out of the live form). Read with `.get()` (or a `current()` helper that accepts plain or Volatile). Prefer reading live values inside handlers so locale/settings changes apply without remount.
2. **Browser half** ships `./client` → `lib/client.js` in the client module system's lazy-CJS factory format (`window.__ModuleLoader__.load({ id, factory })`). Out-of-tree plugins can **hand-write** this (see sibling `dsh-tree-mention`); the monorepo `tsdown.client` preset is not required.
3. Register into a Plugins slot while the Host serves the entry id:
   - `plugins.bundle.config` — keyed by **npm package name**; renders between description and Components (`view: 'page'` only; form is **not** passed in props — use `ctx.configForms.get('<entry-id>')`).
   - `plugins.row.config` — keyed `<package>#<rowId>`; adds a Configure control and receives `form` on the row page.
4. Gate with `ctx.configForms.whileServed(['<entry-id>'], …)` so the slot exists only while the Host exposes that namespace. Declare `dsh.client.inject` for `@deepseek-ai/dsh-client-ui-settings` and `@deepseek-ai/dsh-client-ui-plugin-manager` (and require `react` inside the factory).

Reference in this repo: `index.js` (`Config.locale` volatile) + `lib/client.js` (language select). Sibling patterns: `dsh-web-search-kimi` (Host Config only), `dsh-tree-mention` (hand-written client). Deeper source: harness `packages/client/ui-plugin-manager`, `docs/cookbook/adding-a-settings-card.md`.

## Session history reads (host API)

Current DSH **removed** `Session.events`. Do **not** read `agent.session.events` for turn outcomes — it is always undefined and silently breaks completion logic.

Use `agent.session.snapshotEvents()` (deprecated but still present; optional fallback to `.events` for older hosts). See [notify-troubleshoot.md](references/notify-troubleshoot.md).

## This repo (dsh-notify)

- Package / Cordis name: `dsh-notify` (entry id = package name)
- Entry: `index.js` (ESM); `inject: ['commands']`; exports `Config` (`locale` volatile `zh`|`en`); Windows → WinRT protocol toast (`dsh://open`); other OS → node-notifier
- Browser: `lib/client.js` → `plugins.bundle.config` key `dsh-notify` (Language / 通知语言 select)
- Deps: `node-notifier`, `@deepseek-ai/schemastery` (~3.18.4+)
- Bundle patch: `cordis.patch.yml` inserts `id: dsh-notify`
- Smoke: `/dsh-notify-test`; diagnostics: `~/.dsh/dsh-notify.debug.log`
- Fork remotes: see `git remote -v` (avoid machine-local absolute paths in docs)
- Git author for commits: repo-local config / `.cursor/rules/git-author.mdc`

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
| Windows: toast API works, user sees nothing | Check Win+N and Settings → Notifications → **DSH Notify** |
| Windows: toast click does not focus Desktop | Use WinRT protocol toast (`launch=dsh://open`, appID `com.deepseek.dsh` for Desktop's name/logo); do not rely on snoretoast `-application` or app activation; fully quit/reopen after plugin change |
| Plugins page has Uninstall/Components but no config fields | Need `Config` + `.volatile()` **and** `lib/client.js` registering `plugins.bundle.config` / `plugins.row.config`; schema alone is not enough |
| Language dropdown missing after code change | Confirm `dsh.client` + `./client` export; `pnpm/npm install` in plugin; fully quit Desktop |

## Official docs (fetch only if skill is insufficient)

- First plugin / `apply`: https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/
- Bundle + `dsh plugin add`: https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish
- Live Config forms cookbook: https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-settings-card
- Architecture (profile/bundle): https://deepseek-harness.github.io/deepseek-harness/en/reference/
- Prefer a local harness checkout (`packages/client/ui-plugin-manager`, `docs/cookbook/adding-a-settings-card.md`) over re-fetching when one is available.

Do not re-research these on every session unless versions or errors contradict this skill — then update this skill.
Do not commit machine-local absolute paths or personal usernames into this skill.
