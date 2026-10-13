# dsh-notify checklist extras

Use after the user-level `dsh-plugin-bundle` authoring/install checklist.

## This repo (notify)

- [ ] `node_modules/node-notifier` and `@deepseek-ai/schemastery` present in plugin checkout
- [ ] `~/.dsh/dsh-notify.debug.log` shows `mounted` after restart
- [ ] Plugins → dsh-notify shows Language / 通知语言 between description and Components
- [ ] Smoke: `/dsh-notify-test`, then a short agent turn for completion toast
- [ ] Windows: Win+N / Notifications → **DSH Notify** if toast path works but UI is quiet
- [ ] Details: [notify-troubleshoot.md](notify-troubleshoot.md)
