# DSH bundle checklist

Use when packaging a new plugin or diagnosing install failures.

## Authoring

- [ ] Module exports `apply` (and `name` if useful)
- [ ] `package.json` has `"type": "module"` and correct `main`
- [ ] `package.json` has `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
- [ ] `cordis.patch.yml` inserts a row whose `name` equals the package `name`
- [ ] `files` includes both the entry module and every patch YAML
- [ ] Runtime deps listed under `dependencies`; plugin checkout installed once

## Install

- [ ] Target profile chosen (`web` / `desktop` / …)
- [ ] `dsh plugin --profile <p> add <path|github:…>`
- [ ] `dsh --profile <p> --dump-config` shows `# == <package>`
- [ ] Smoke-test plugin behavior (this repo: `/dsh-notify-test`)

## Overrides

- [ ] User tweaks go in profile `cordis.patch.yml` by `id`
- [ ] Entire `config` restated (no deep merge)
