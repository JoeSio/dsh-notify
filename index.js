// dsh-notify — DSH 系统通知插件
//
// 在宿主进程内监听 Cordis 事件，把以下时机以操作系统通知的形式推送出来。
// 通知发送优先走 node-notifier（跨平台封装：Linux→notify-send、
// macOS→terminal-notifier、Windows→snoretoast），库不可用时回退到
// 直接调用系统命令（notify-send / osascript）：
//
//   - 任务完成    agent/status 由 running 回到 idle，且最近一轮 turn/end 的
//                reason 为 completed / max-tokens（只通知根 agent，忽略子 agent）
//   - 任务出错    最近一轮 turn/end 的 reason 为 error
//   - 阻塞提问    tools/execute 派发 ask_user_question（工具阻塞等待用户回答）
//   - 等待审批    approval/request 派发（工具等待用户批准）
//
// Windows 点击唤起：WinRT toast（activationType=protocol, launch=dsh://open）。
// snoretoast `-application` 在 Action Center 点击时不会启动；named pipe 会在横幅
// 超时后退出，晚点击收不到 activate。协议激活不依赖回调。
// 会话直达仍需 harness 透传 session=。
//
// 安装、配置与排查见仓库 README.md。
//
// Config 用 schemastery 声明；locale 为 .volatile()，可在 Plugins 页下拉切换
// 而无需重挂插件。浏览器半在 lib/client.js，注册 plugins.bundle.config。

import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";

/** Cordis 插件名（与组合行的 name 一致）。 */
const name = "dsh-notify";

/** Wait for the command registry so `/dsh-notify-test` is always registered. */
const inject = ["commands"];

/**
 * Cordis validates this into the settings form. Only volatile fields are
 * editable live on the Plugins page; locale is the one we surface as a select.
 */
const Config = z.object({
  enabled: z.boolean().default(true),
  appName: z.string().default("DSH"),
  locale: z
    .union(["zh", "en"])
    .default("zh")
    .volatile()
    .description("Language for notification titles and fallback bodies."),
  notifyOnComplete: z.boolean().default(true),
  notifyOnError: z.boolean().default(true),
  notifyOnQuestion: z.boolean().default(true),
  notifyOnApproval: z.boolean().default(true),
  // 只通知根 agent（子 agent 完成时静默，避免子代理扇出刷屏）。
  rootsOnly: z.boolean().default(true),
  completeUrgency: z.union(["low", "normal", "critical"]).default("normal"),
  blockingUrgency: z.union(["low", "normal", "critical"]).default("critical"),
  errorUrgency: z.union(["low", "normal", "critical"]).default("critical"),
  bodyLimit: z.number().step(1).min(1).default(100),
});

/** User-facing notification strings by locale. */
const MESSAGES = {
  zh: {
    taskComplete: "任务完成",
    maxTokensSuffix: "（达到输出上限）",
    sessionFallback: (id) => `会话 ${id}`,
    taskError: "任务出错",
    agentErrorFallback: "agent 运行出错",
    needsAnswer: "需要你回答",
    waitingAnswerFallback: "agent 正在等待你的回答",
    awaitingApproval: "等待审批",
    toolNeedsApproval: (tool) => `工具 ${tool} 需要审批`,
    testTitle: "测试通知",
    testBody: "dsh-notify 插件工作正常",
    testCommandOk: "已发送测试通知，请查看系统通知栏（Win+N）。点击通知可唤起 Desktop。",
    testCommandDescription: "发送一条 dsh-notify 测试系统通知",
  },
  en: {
    taskComplete: "Task complete",
    maxTokensSuffix: " (hit output limit)",
    sessionFallback: (id) => `Session ${id}`,
    taskError: "Task error",
    agentErrorFallback: "Agent error",
    needsAnswer: "Needs your answer",
    waitingAnswerFallback: "Agent is waiting for your answer",
    awaitingApproval: "Awaiting approval",
    toolNeedsApproval: (tool) => `Tool ${tool} needs approval`,
    testTitle: "Test notification",
    testBody: "dsh-notify is working",
    testCommandOk: "Test notification sent. Check the system notification center (Win+N). Click the toast to focus Desktop.",
    testCommandDescription: "Send a dsh-notify test system notification",
  },
};

/** Read one config field whether Cordis hands over a Volatile or a plain value. */
function current(field) {
  if (field === undefined || field === null) return undefined;
  return typeof field.get === "function" ? field.get() : field;
}

/** Normalize config locale to a supported message catalog key. */
function resolveLocale(locale) {
  if (typeof locale !== "string" || !locale.trim()) return "zh";
  const base = locale.trim().toLowerCase().split(/[-_]/)[0];
  return base === "en" ? "en" : "zh";
}

function messagesFor(locale) {
  return MESSAGES[resolveLocale(locale)];
}

/** Snapshot non-volatile options; locale is read live per notification. */
function optionsSnapshot(config) {
  const raw = config ?? {};
  return {
    enabled: current(raw.enabled) !== false,
    appName: current(raw.appName) ?? "DSH",
    notifyOnComplete: current(raw.notifyOnComplete) !== false,
    notifyOnError: current(raw.notifyOnError) !== false,
    notifyOnQuestion: current(raw.notifyOnQuestion) !== false,
    notifyOnApproval: current(raw.notifyOnApproval) !== false,
    rootsOnly: current(raw.rootsOnly) !== false,
    completeUrgency: current(raw.completeUrgency) ?? "normal",
    blockingUrgency: current(raw.blockingUrgency) ?? "critical",
    errorUrgency: current(raw.errorUrgency) ?? "critical",
    bodyLimit: current(raw.bodyLimit) ?? 100,
    localeField: raw.locale,
  };
}

/** Append one diagnostic line under ~/.dsh (Desktop host stdout is not visible). */
function debugLog(message) {
  try {
    const dir = join(homedir(), ".dsh");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "dsh-notify.debug.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Diagnostics must never break the host.
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 压缩为单行并截断。 */
function truncate(text, limit) {
  if (typeof text !== "string") return "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= limit ? oneLine : `${oneLine.slice(0, Math.max(0, limit - 1))}…`;
}

/**
 * Read the session event log. Current DSH removed `Session.events`; use
 * `snapshotEvents()` (still available, deprecated). Fall back to `.events` for
 * older hosts.
 */
function sessionEvents(agent) {
  const session = agent?.session;
  if (session === undefined || session === null) return undefined;
  if (typeof session.snapshotEvents === "function") {
    try {
      return session.snapshotEvents();
    } catch {
      return undefined;
    }
  }
  const legacy = session.events;
  return Array.isArray(legacy) ? legacy : undefined;
}

/** 从会话事件日志中自后向前找最后一个指定类型的事件。 */
function lastEvent(agent, type) {
  const events = sessionEvents(agent);
  if (!Array.isArray(events)) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event !== null && typeof event === "object" && event.type === type) return event;
  }
  return undefined;
}

/** 最近一轮 turn/end 的 reason（{ kind: "completed" | "max-tokens" | "blocked" | "aborted" | "error", ... }）。 */
function lastTurnReason(agent) {
  return lastEvent(agent, "turn/end")?.data?.reason;
}

/** 会话中最近一条用户消息的纯文本。 */
function lastUserText(agent) {
  const content = lastEvent(agent, "user/message")?.data?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
    }
  }
  return "";
}

/** 从 ask_user_question 的参数里取出问题文本。 */
function questionText(args) {
  if (args === null || typeof args !== "object") return "";
  const questions = args.questions;
  if (!Array.isArray(questions)) return "";
  const texts = [];
  for (const question of questions) {
    if (question === null || typeof question !== "object") continue;
    const text =
      typeof question.question === "string" && question.question
        ? question.question
        : typeof question.header === "string"
          ? question.header
          : "";
    if (text) texts.push(text);
  }
  return truncate(texts.join(" / "), 120);
}

/** 从 turn/end reason.error 里提取可读信息。 */
function errorText(reason) {
  const error = reason?.error;
  if (error === undefined || error === null) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const message = error.message;
    if (typeof message === "string" && message) return message;
    const code = error.code;
    if (typeof code === "string" && code) return code;
  }
  return "";
}

// ---------------------------------------------------------------------------
// 通知发送
// ---------------------------------------------------------------------------

// 主路径：node-notifier（跨平台封装，处理了各平台的参数映射、转义与
// Windows 支持）。从插件自身位置解析，避免依赖宿主进程的模块图。
// 未安装时置空，走下方回退路径——通知插件不应因缺依赖而拖垮宿主加载。
let notifier = null;
try {
  notifier = createRequire(import.meta.url)("node-notifier");
} catch (error) {
  console.warn(`[dsh-notify] node-notifier 未安装（在仓库目录执行 pnpm install 可装），回退到直接调用系统命令: ${error?.message ?? error}`);
}

/**
 * Desktop's AppUserModelID, registered by its installer; Windows takes the toast's
 * name and logo from that Start Menu shortcut. Toasts must use protocol activation
 * (`dsh://open`): Desktop has no toast activator, so app activation would do nothing.
 */
const WINDOWS_NOTIFY_APP_ID = "com.deepseek.dsh";
const DSH_FOCUS_URL = "dsh://open";

/** Resolve bundled snoretoast.exe next to node-notifier. */
function resolveSnoretoastPath() {
  try {
    const require = createRequire(import.meta.url);
    const notifierRoot = join(require.resolve("node-notifier/package.json"), "..");
    return join(
      notifierRoot,
      "vendor",
      "snoreToast",
      process.arch === "x64" ? "snoretoast-x64.exe" : "snoretoast-x86.exe",
    );
  } catch {
    return undefined;
  }
}

/** Escape text for inclusion inside a WinRT toast XML document. */
function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Show a WinRT toast whose body click launches `dsh://open` (protocol activation).
 * Falls back to snoretoast (display-only) if PowerShell / WinRT is unavailable.
 */
function sendWindowsToast(title, body) {
  const snore = resolveSnoretoastPath();

  const xml = `<toast activationType="protocol" launch="${escapeXml(DSH_FOCUS_URL)}">
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXml(title)}</text>
      <text>${escapeXml(body)}</text>
    </binding>
  </visual>
</toast>`;
  const xmlBase64 = Buffer.from(xml, "utf8").toString("base64");
  const stamp = `${process.pid}-${Date.now()}`;
  const scriptPath = join(tmpdir(), `dsh-notify-toast-${stamp}.ps1`);
  const ps1 = [
    "$ErrorActionPreference = 'Stop'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    `$xmlText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${xmlBase64}'))`,
    "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$doc.LoadXml($xmlText)",
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${WINDOWS_NOTIFY_APP_ID}').Show($toast)`,
  ].join("\r\n");

  try {
    writeFileSync(scriptPath, ps1, "utf8");
  } catch (error) {
    debugLog(`winrt-script-write-failed ${error?.message ?? error}`);
    sendWindowsToastSnoretoastFallback(snore, title, body);
    return;
  }

  debugLog(`winrt-toast appID=${WINDOWS_NOTIFY_APP_ID} launch=${DSH_FOCUS_URL} script=${JSON.stringify(scriptPath)}`);
  execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { windowsHide: true },
    (error) => {
      try {
        if (existsSync(scriptPath)) unlinkSync(scriptPath);
      } catch {
        // ignore
      }
      if (error) {
        console.error(`[dsh-notify] WinRT toast 失败: ${error.message}`);
        debugLog(`winrt-toast-error ${error.message}`);
        sendWindowsToastSnoretoastFallback(snore, title, body);
        return;
      }
      debugLog("winrt-toast-ok shown");
    },
  );
}

/** Display-only snoretoast fallback when WinRT protocol toast cannot be shown. */
function sendWindowsToastSnoretoastFallback(snore, title, body) {
  if (snore === undefined || !existsSync(snore)) {
    console.error("[dsh-notify] 无法定位 snoretoast");
    debugLog("snoretoast-resolve-failed");
    return;
  }
  debugLog(`snoretoast-fallback appID=${WINDOWS_NOTIFY_APP_ID}`);
  execFile(snore, ["-t", title, "-m", body, "-appID", WINDOWS_NOTIFY_APP_ID], { windowsHide: true }, (error) => {
    if (error && error.code !== 3 && error.code !== 2 && error.code !== 1) {
      console.error(`[dsh-notify] snoretoast 失败: ${error.message}`);
      debugLog(`snoretoast-error ${error.message} code=${error.code}`);
      return;
    }
    debugLog(`snoretoast-fallback-ok code=${error?.code ?? 0}`);
  });
}

/**
 * 发送一条系统通知。
 * @param options 合并后的插件配置（appName 等）
 * @param title 标题
 * @param body 正文
 * @param urgency low | normal | critical（macOS 不支持，会被忽略）
 */
function sendNotification(options, title, body, urgency) {
  console.log(`[dsh-notify] ${title}: ${body}`);
  debugLog(`notify title=${JSON.stringify(title)} body=${JSON.stringify(body)} platform=${process.platform}`);

  // Windows: WinRT protocol toast (click → dsh://open).
  if (process.platform === "win32") {
    sendWindowsToast(title, body);
    return;
  }

  // 主路径：node-notifier（非 Windows）。
  if (notifier !== null) {
    try {
      notifier.notify(
        { title, message: body, urgency, appName: options.appName },
        (error, response, metadata) => {
          if (error) {
            console.error(`[dsh-notify] 通知发送失败: ${error.message ?? error}`);
            debugLog(`notify-error ${error.message ?? error}`);
            return;
          }
          debugLog(`notify-ok response=${JSON.stringify(response)} meta=${JSON.stringify(metadata)}`);
        },
      );
      return;
    } catch (error) {
      console.error(`[dsh-notify] 通知发送失败: ${String(error)}`);
      debugLog(`notify-throw ${String(error)}`);
    }
    return;
  }

  // 回退路径：直接调用系统命令（仅当 node-notifier 不可用时）。
  try {
    if (process.platform === "linux") {
      execFile("notify-send", ["-a", options.appName, "-u", urgency, title, body], (error) => {
        if (error) console.error(`[dsh-notify] notify-send 失败: ${error.message}`);
      });
    } else if (process.platform === "darwin") {
      const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
      execFile("osascript", ["-e", script], (error) => {
        if (error) console.error(`[dsh-notify] osascript 失败: ${error.message}`);
      });
    } else {
      console.log(`[dsh-notify] 当前平台 ${process.platform} 不支持桌面通知，仅记录日志`);
    }
  } catch (error) {
    console.error(`[dsh-notify] 发送通知失败: ${String(error)}`);
    debugLog(`fallback-throw ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

function apply(ctx, config) {
  const options = optionsSnapshot(config);
  if (!options.enabled) {
    console.log("[dsh-notify] disabled by config, not mounting listeners");
    debugLog("disabled by config");
    return;
  }

  function liveLocale() {
    return resolveLocale(current(options.localeField) ?? "zh");
  }

  function liveMsg() {
    return messagesFor(liveLocale());
  }

  debugLog(
    `mounting notifier=${notifier !== null} locale=${liveLocale()} rootsOnly=${options.rootsOnly} platform=${process.platform} execPath=${process.execPath}`,
  );

  // Optional: agents (root filter). commands is injected.
  const agents = ctx.get("agents");

  function isRoot(agent) {
    if (agent === undefined) return !options.rootsOnly;
    if (!options.rootsOnly) return true;
    if (agents === undefined) return true;
    return agents.roots().some((root) => root.id === agent.id);
  }

  // 1) 任务完成 / 任务出错：agent 由 running 回到 idle（此刻 turn/end 已落盘）。
  ctx.on("agent/status", (payload) => {
    try {
      if (payload?.status !== "idle") return;
      const agent = payload.agent;
      if (!isRoot(agent)) {
        debugLog(`status-idle skip non-root agent=${agent?.id}`);
        return;
      }
      const reason = lastTurnReason(agent);
      if (reason === undefined) {
        debugLog(`status-idle skip no turn/end agent=${agent?.id}`);
        return;
      }
      const msg = liveMsg();
      if (reason.kind === "completed" || reason.kind === "max-tokens") {
        if (!options.notifyOnComplete) return;
        const summary = truncate(lastUserText(agent), options.bodyLimit) || msg.sessionFallback(agent.id);
        const suffix = reason.kind === "max-tokens" ? msg.maxTokensSuffix : "";
        sendNotification(options, `${options.appName} · ${msg.taskComplete}${suffix}`, summary, options.completeUrgency);
      } else if (reason.kind === "error") {
        if (!options.notifyOnError) return;
        const detail = truncate(errorText(reason), options.bodyLimit) || msg.agentErrorFallback;
        sendNotification(options, `${options.appName} · ${msg.taskError}`, detail, options.errorUrgency);
      } else {
        // kind === "aborted"（用户取消）与 "blocked"（内部拒绝）不通知。
        debugLog(`status-idle skip reason.kind=${reason.kind} agent=${agent?.id}`);
      }
    } catch (error) {
      console.error(`[dsh-notify] agent/status 处理失败: ${String(error)}`);
      debugLog(`status-idle error ${String(error)}`);
    }
  });

  // 2) 阻塞提问：ask_user_question 派发后工具会一直阻塞到用户回答。
  ctx.on("tools/execute", (exec, next) => {
    try {
      if (exec?.name === "ask_user_question" && options.notifyOnQuestion && isRoot(exec.agent)) {
        const msg = liveMsg();
        const text = questionText(exec.arguments);
        sendNotification(
          options,
          `${options.appName} · ${msg.needsAnswer}`,
          text || msg.waitingAnswerFallback,
          options.blockingUrgency,
        );
      }
    } catch (error) {
      console.error(`[dsh-notify] tools/execute 处理失败: ${String(error)}`);
    }
    return next();
  });

  // 3) 等待审批：工具派发被审批环节挂起。
  ctx.on("approval/request", (req, next) => {
    try {
      if (options.notifyOnApproval && isRoot(req?.agent)) {
        const msg = liveMsg();
        const detail =
          truncate(req.reason ?? "", options.bodyLimit) || msg.toolNeedsApproval(req.toolName ?? "?");
        sendNotification(options, `${options.appName} · ${msg.awaitingApproval}`, detail, options.blockingUrgency);
      }
    } catch (error) {
      console.error(`[dsh-notify] approval/request 处理失败: ${String(error)}`);
    }
    return next();
  });

  // 测试命令：/dsh-notify-test —— 手动验证通知链路。
  ctx.effect(function* () {
    const initialMsg = liveMsg();
    yield ctx.commands.register({
      name: "dsh-notify-test",
      description: initialMsg.testCommandDescription,
      handler: () => {
        const msg = liveMsg();
        sendNotification(options, `${options.appName} · ${msg.testTitle}`, msg.testBody, "normal");
        return { kind: "success", text: msg.testCommandOk };
      },
    });
  }, "dsh-notify test command");

  console.log(
    `[dsh-notify] 插件已挂载 (locale=${liveLocale()}, rootsOnly=${options.rootsOnly}, notifyOnComplete=${options.notifyOnComplete}, ` +
      `notifyOnQuestion=${options.notifyOnQuestion}, notifyOnApproval=${options.notifyOnApproval}, ` +
      `notifyOnError=${options.notifyOnError})`,
  );
  debugLog("mounted listeners + /dsh-notify-test");
}

export { apply, Config, inject, name };
