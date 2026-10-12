/**
 * dsh-notify — browser half.
 *
 * Registers a Language select on the Plugins → dsh-notify bundle detail page
 * (`plugins.bundle.config`, keyed by package name). Saves through
 * `ctx.configForms.get('dsh-notify')` so the Host volatile field updates without
 * remounting the plugin.
 *
 * Hand-written in the module-loader bundle format (same approach as
 * dsh-tree-mention); no build step. Requires react + configForms / slots from
 * the web composition (declared in package.json dsh.client.inject).
 */
window.__ModuleLoader__.load({
  id: "dsh-notify",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var useEffect = React.useEffect;
    var useState = React.useState;
    var useSyncExternalStore = React.useSyncExternalStore;
    var createElement = React.createElement;

    var ENTRY_ID = "dsh-notify";
    var PACKAGE_NAME = "dsh-notify";
    var CHOICES = [
      { value: "zh", label: "中文" },
      { value: "en", label: "English" },
    ];

    function normalizeLocale(value) {
      if (typeof value !== "string" || !value.trim()) return "zh";
      return value.trim().toLowerCase().split(/[-_]/)[0] === "en" ? "en" : "zh";
    }

    function LocaleSettings(props) {
      var form = props.form;
      if (props.view !== "page" || !form) return null;

      var snap = useSyncExternalStore(
        function (onStoreChange) {
          return form.subscribe(onStoreChange);
        },
        function () {
          return form.getSnapshot();
        },
      );

      var accepted = normalizeLocale(snap.value && snap.value.locale);
      var draftState = useState(accepted);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var savingState = useState(false);
      var saving = savingState[0];
      var setSaving = savingState[1];
      var errorState = useState(null);
      var error = errorState[0];
      var setError = errorState[1];

      useEffect(
        function () {
          setDraft(accepted);
          setError(null);
        },
        [accepted],
      );

      var disabled = !snap.writable || snap.status !== "ready" || saving;
      var dirty = draft !== accepted;

      function onSave() {
        if (disabled || !dirty) return;
        setSaving(true);
        setError(null);
        var revision = snap.revision;
        Promise.resolve(form.set("locale", draft))
          .then(function (ok) {
            if (!ok) setError("Could not save language (revision conflict or Host refused).");
          })
          .catch(function (err) {
            setError(String((err && err.message) || err));
          })
          .finally(function () {
            setSaving(false);
          });
        void revision;
      }

      return createElement(
        "div",
        {
          "data-dsh-notify-locale": "",
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            maxWidth: "360px",
          },
        },
        createElement(
          "label",
          {
            htmlFor: "dsh-notify-locale",
            style: { fontSize: "13px", fontWeight: 500 },
          },
          "Language / 通知语言",
        ),
        createElement(
          "select",
          {
            id: "dsh-notify-locale",
            value: draft,
            disabled: disabled,
            onChange: function (event) {
              setDraft(normalizeLocale(event.target.value));
            },
            style: { height: "32px", padding: "0 8px" },
          },
          CHOICES.map(function (choice) {
            return createElement("option", { key: choice.value, value: choice.value }, choice.label);
          }),
        ),
        createElement(
          "div",
          { style: { display: "flex", gap: "8px", alignItems: "center" } },
          createElement(
            "button",
            {
              type: "button",
              disabled: disabled || !dirty,
              onClick: onSave,
            },
            saving ? "Saving…" : "Save",
          ),
          snap.status === "loading" ? createElement("span", null, "Loading…") : null,
          snap.status === "unavailable"
            ? createElement("span", null, "Settings unavailable in this session.")
            : null,
        ),
        error ? createElement("p", { role: "status" }, error) : null,
      );
    }

    function apply(ctx) {
      var form = ctx.configForms.get(ENTRY_ID);
      ctx.effect(function () {
        return ctx.configForms.whileServed([ENTRY_ID], function () {
          return ctx.slots.inject("plugins.bundle.config", function () {
            return ctx.slots.register(
              {
                name: "plugins.bundle.config",
                key: PACKAGE_NAME,
                inject: function () {
                  return { form: form };
                },
              },
              LocaleSettings,
            );
          });
        });
      }, "dsh-notify: language form");
    }

    exports.apply = apply;
    exports.inject = ["slots", "configForms"];
    return module.exports;
  },
});
