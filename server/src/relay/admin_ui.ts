export function renderRelayAdminHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CodexTavernBridge Console</title>
  <style>
    :root {
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      --bg: oklch(98.6% 0.006 230);
      --surface: oklch(99.3% 0.004 230);
      --panel: oklch(99.7% 0.004 230);
      --soft: oklch(98% 0.007 230);
      --line: oklch(90.4% 0.014 230);
      --line-strong: oklch(82.5% 0.022 230);
      --text: oklch(22% 0.028 245);
      --muted: oklch(49% 0.03 245);
      --subtle: oklch(64% 0.026 245);
      --mint: oklch(83% 0.072 154);
      --mint-strong: oklch(67% 0.092 154);
      --mint-soft: oklch(96.8% 0.032 154);
      --blue: oklch(62% 0.105 238);
      --blue-soft: oklch(95.5% 0.03 238);
      --cyan-soft: oklch(95.5% 0.04 205);
      --green: oklch(62% 0.13 150);
      --green-soft: oklch(95.5% 0.045 150);
      --yellow: oklch(78% 0.13 83);
      --yellow-soft: oklch(96.5% 0.05 83);
      --red: oklch(55% 0.17 28);
      --red-soft: oklch(96.5% 0.035 28);
      --shadow: 0 1px 2px oklch(22% 0.028 245 / .05), 0 14px 36px oklch(22% 0.028 245 / .08);
      --radius: 8px;
      --radius-sm: 6px;
    }

    * { box-sizing: border-box; }
    html { min-height: 100%; background: var(--bg); }
    body { min-height: 100%; margin: 0; color: var(--text); background: var(--bg); }
    body.modal-open { overflow: hidden; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 19px; line-height: 1.25; letter-spacing: 0; }
    h2 { font-size: 15px; line-height: 1.35; letter-spacing: 0; }
    h3 { font-size: 13px; line-height: 1.35; letter-spacing: 0; }
    p { color: var(--muted); font-size: 13px; line-height: 1.55; }
    button, input, select, textarea { font: inherit; }
    button { min-height: 34px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 7px 11px; color: var(--text); background: var(--panel); cursor: pointer; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
    button:hover { border-color: oklch(71% 0.055 245); background: oklch(98.2% 0.007 230); box-shadow: 0 6px 18px oklch(22% 0.028 245 / .08); transform: translateY(-1px); }
    button:active { transform: translateY(0); box-shadow: inset 0 1px 5px oklch(22% 0.028 245 / .14); }
    button.primary { border-color: oklch(76% 0.074 154); background: var(--mint); color: oklch(28% 0.065 154); }
    button.primary:hover { background: oklch(80% 0.082 154); }
    button.danger { border-color: oklch(78% 0.08 28); background: var(--red-soft); color: oklch(40% 0.15 28); }
    button.ghost { border-color: transparent; background: transparent; box-shadow: none; color: var(--muted); }
    button:disabled { cursor: not-allowed; opacity: .58; transform: none; box-shadow: none; }
    input, select, textarea { width: 100%; min-height: 34px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 7px 9px; color: var(--text); background: var(--panel); }
    textarea { min-height: 86px; resize: vertical; line-height: 1.5; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid oklch(80% 0.08 246 / .55); outline-offset: 2px; }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
    code, pre, .mono { font-family: "Cascadia Mono", Consolas, "Courier New", monospace; }
    pre { max-height: 420px; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }

    .topbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 72px; padding: 14px 20px; border-bottom: 1px solid var(--line); background: oklch(99.2% 0.005 230); }
    .brand { display: grid; gap: 3px; min-width: 260px; }
    .brand-sub { color: var(--muted); font-size: 12px; }
    .top-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .top-actions label { display: flex; align-items: center; gap: 7px; color: var(--muted); }
    .top-actions input { width: 112px; }
    .workspace { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 16px; max-width: 1620px; margin: 0 auto; padding: 16px; }
    .sidebar { display: grid; align-content: start; gap: 12px; }
    .side-card { border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: 0 1px 2px oklch(22% 0.028 245 / .04); overflow: hidden; }
    .nav { display: grid; padding: 8px; gap: 3px; }
    .nav button { display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 10px; width: 100%; min-height: 38px; border-color: transparent; background: transparent; box-shadow: none; text-align: left; color: var(--muted); }
    .nav button.active { border-color: oklch(86% 0.048 154); background: var(--mint-soft); color: var(--text); }
    .nav-kicker { color: var(--subtle); font-size: 11px; }
    .focus-card { padding: 14px; }
    .focus-card p { margin-top: 8px; }
    .main { min-width: 0; }
    .page { display: none; animation: fade-in .16s ease-out; }
    .page.active { display: block; }
    .panel { border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: 0 1px 2px oklch(22% 0.028 245 / .04); overflow: clip; }
    .panel + .panel { margin-top: 14px; }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--line); background: oklch(99.4% 0.004 230); }
    .panel-title { display: grid; gap: 3px; }
    .panel-body { padding: 16px; }
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; padding: 9px 8px; border-bottom: 1px solid var(--line); background: var(--soft); }
    .tabs button { min-height: 34px; }
    .tabs button.active { border-color: oklch(86% 0.05 154); background: var(--mint-soft); color: oklch(34% 0.075 154); box-shadow: inset 0 0 0 1px oklch(91% 0.035 154); }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .grid { display: grid; gap: 12px; }
    .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .split { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 14px; align-items: start; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: end; }
    .span { grid-column: 1 / -1; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .stack { display: grid; gap: 10px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); color: var(--muted); font-size: 12px; }
    .pill.ok { color: oklch(38% 0.12 150); border-color: oklch(84% 0.07 150); background: var(--green-soft); }
    .pill.warn { color: oklch(43% 0.11 83); border-color: oklch(84% 0.08 83); background: var(--yellow-soft); }
    .pill.bad { color: oklch(40% 0.15 28); border-color: oklch(84% 0.08 28); background: var(--red-soft); }
    .dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
    .metric { padding: 13px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
    .metric.ok { border-color: oklch(84% 0.07 150); background: var(--green-soft); }
    .metric.warn { border-color: oklch(84% 0.08 83); background: var(--yellow-soft); }
    .metric.bad { border-color: oklch(84% 0.08 28); background: var(--red-soft); }
    .metric-label { color: var(--muted); font-size: 12px; }
    .metric-value { margin-top: 6px; font-size: 21px; font-weight: 760; line-height: 1.05; overflow-wrap: anywhere; }
    .metric-note { margin-top: 5px; color: var(--subtle); font-size: 12px; overflow-wrap: anywhere; }
    .card-button, .module-card { display: block; width: 100%; min-height: unset; padding: 13px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: none; text-align: left; }
    .card-button.active, .module-card.active { border-color: oklch(84% 0.052 154); background: var(--mint-soft); box-shadow: inset 0 0 0 1px oklch(91% 0.035 154); }
    .module-card { display: grid; gap: 8px; min-height: 108px; }
    .module-title { display: flex; justify-content: space-between; gap: 8px; font-weight: 720; }
    .module-meta, .item-meta { color: var(--muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
    .item { padding: 11px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
    .item-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .item-title { font-weight: 700; overflow-wrap: anywhere; }
    .empty { padding: 14px; border: 1px dashed var(--line-strong); border-radius: var(--radius); color: var(--muted); background: var(--soft); }
    .records { display: grid; gap: 8px; }
    .record { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 11px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
    .record-preview { margin-top: 4px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .trigger-shell { display: grid; gap: 12px; }
    .trigger-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--soft); }
    .trigger-daybar { display: grid; grid-template-columns: repeat(7, minmax(88px, 1fr)); gap: 7px; }
    .trigger-day { min-height: 56px; display: grid; align-content: center; gap: 2px; border-color: var(--line); background: var(--panel); text-align: center; }
    .trigger-day.active { border-color: oklch(78% 0.074 154); background: var(--mint-soft); box-shadow: inset 0 0 0 1px oklch(90% 0.04 154); }
    .trigger-day.today { color: oklch(35% 0.09 154); }
    .trigger-day-date { font-size: 12px; font-weight: 760; }
    .trigger-day-week { color: var(--muted); font-size: 11px; }
    .trigger-list { display: grid; gap: 9px; }
    .trigger { position: relative; display: grid; grid-template-columns: 168px minmax(0, 1fr) 128px; gap: 14px; align-items: center; min-height: 92px; padding: 14px 42px 14px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: 0 1px 2px oklch(22% 0.028 245 / .035); }
    .trigger:hover { border-color: oklch(84% 0.052 154); background: oklch(99.2% 0.012 154); }
    .trigger.paused { opacity: .72; }
    .trigger-timebox { display: grid; gap: 5px; align-content: center; }
    .trigger-main { display: grid; gap: 5px; min-width: 0; }
    .trigger-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-right: 6px; }
    .trigger-source { color: var(--subtle); font-size: 12px; }
    .task-time { color: oklch(38% 0.105 174); font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; font-weight: 760; }
    .week-shell { overflow: auto; }
    .week-board { min-width: 940px; display: grid; grid-template-columns: repeat(7, minmax(120px, 1fr)); gap: 8px; }
    .section-note { margin-bottom: 10px; padding: 10px 11px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--soft); color: var(--muted); font-size: 12px; line-height: 1.55; }
    .day-column { min-height: 260px; border: 1px solid var(--line); border-radius: var(--radius); background: oklch(99.3% 0.004 230); padding: 10px; }
    .day-column.weekend { background: oklch(98.7% 0.016 83); }
    .day-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; color: var(--muted); font-size: 12px; font-weight: 720; }
    .task { position: relative; display: grid; gap: 6px; margin-top: 8px; padding: 10px 32px 10px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); }
    .task.paused { opacity: .72; background: oklch(98% 0.01 152); }
    .task.inactive-day { opacity: .48; background: oklch(96.8% 0.006 230); filter: grayscale(.18); }
    .task.readonly { padding-right: 10px; }
    .task-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; min-width: 28px; height: 28px; min-height: 28px; padding: 0; border-radius: 999px; line-height: 1; }
    .close-btn { position: absolute; top: 6px; right: 6px; width: 24px; min-width: 24px; height: 24px; min-height: 24px; padding: 0; border-color: transparent; background: transparent; color: var(--subtle); font-size: 18px; line-height: 1; box-shadow: none; }
    .close-btn:hover { color: oklch(42% 0.15 28); background: var(--red-soft); border-color: oklch(84% 0.08 28); box-shadow: none; }
    .switch-btn { position: relative; width: 44px; min-width: 44px; height: 24px; min-height: 24px; padding: 0; border-radius: 999px; border-color: oklch(76% 0.04 245); background: oklch(90% 0.012 245); box-shadow: none; }
    .switch-btn::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 999px; background: var(--panel); box-shadow: 0 1px 3px oklch(22% 0.028 245 / .2); transition: transform .16s ease; }
    .switch-btn.on { border-color: oklch(76% 0.075 154); background: var(--mint); }
    .switch-btn.on::after { transform: translateX(20px); }
    .day-checks { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
    .check-tile { display: flex; align-items: center; justify-content: center; gap: 5px; min-height: 34px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--soft); font-size: 12px; }
    .check-tile input { width: auto; min-height: unset; }
    .timetable { min-width: 1040px; display: grid; grid-template-columns: 92px repeat(7, minmax(128px, 1fr)); border: 1px solid var(--line); border-radius: var(--radius); overflow: clip; background: var(--panel); }
    .timetable-cell { min-height: 76px; padding: 8px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .timetable-cell:nth-child(8n) { border-right: 0; }
    .timetable-head { min-height: 44px; display: grid; place-items: center; background: var(--mint-soft); color: oklch(34% 0.075 154); font-size: 12px; font-weight: 760; }
    .timetable-time { background: var(--soft); color: var(--muted); font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; font-weight: 720; }
    .timetable-slot { display: grid; align-content: start; gap: 6px; background: oklch(99.3% 0.004 230); }
    .timetable-slot.weekend { background: oklch(99% 0.013 83); }
    .course-chip { display: grid; gap: 4px; min-height: 58px; padding: 8px; border: 1px solid oklch(86% 0.052 154); border-radius: var(--radius-sm); background: var(--mint-soft); box-shadow: 0 1px 2px oklch(22% 0.028 245 / .04); }
    .course-chip.paused { opacity: .62; background: oklch(97% 0.008 230); border-color: var(--line); filter: grayscale(.18); }
    .course-chip-title { font-size: 12px; font-weight: 760; line-height: 1.35; overflow-wrap: anywhere; }
    .course-chip-meta { color: var(--muted); font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
    .calendar-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
    .calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
    .cal-weekday { color: var(--muted); font-size: 12px; font-weight: 720; text-align: center; padding: 6px 0; }
    .cal-day { position: relative; min-height: 78px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); padding: 8px; text-align: left; }
    .cal-day.outside { color: var(--subtle); background: oklch(97.4% 0.006 230); }
    .cal-day.weekend { background: oklch(98.7% 0.016 83); }
    .cal-day.today { border-color: oklch(78% 0.074 154); box-shadow: inset 0 0 0 1px oklch(90% 0.04 154); }
    .cal-day.selected { border-color: var(--mint-strong); background: var(--mint-soft); box-shadow: inset 0 0 0 1px oklch(78% 0.07 154), 0 8px 22px oklch(67% 0.092 154 / .12); }
    .cal-num { font-weight: 720; }
    .cal-tag { position: absolute; top: 8px; right: 8px; color: var(--subtle); font-size: 11px; }
    .cal-tag.today { padding: 1px 6px; border: 1px solid oklch(84% 0.06 154); border-radius: 999px; background: var(--mint-soft); color: oklch(37% 0.08 154); font-weight: 760; }
    .cal-dots { position: absolute; left: 8px; right: 8px; bottom: 7px; display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
    .count-dot { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; border-radius: 999px; color: var(--text); font-size: 11px; font-weight: 760; }
    .count-dot.user { background: oklch(90% 0.085 150); }
    .count-dot.role { background: oklch(91% 0.105 83); }
    .count-dot.task { background: oklch(90% 0.07 205); }
    .note-list { display: grid; gap: 8px; }
    .note { padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--line); line-height: 1.45; }
    .note.user { background: var(--green-soft); border-color: oklch(84% 0.08 150); }
    .note.role { background: var(--yellow-soft); border-color: oklch(86% 0.09 83); }
    .sticky-form { display: grid; gap: 8px; padding: 11px; border: 1px solid var(--line); border-radius: var(--radius); background: oklch(99.2% 0.006 83); }
    .sticky-form textarea { min-height: 92px; background: oklch(99.7% 0.006 83); }
    .context-split { grid-template-columns: minmax(0, 1fr) 360px; }
    .chat-window { display: grid; grid-template-rows: minmax(260px, 1fr) auto; min-height: 560px; }
    .chat-log { display: grid; align-content: start; gap: 10px; min-height: 260px; max-height: 520px; overflow: auto; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: oklch(99.1% 0.004 230); }
    .chat-message { max-width: 82%; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
    .chat-message.user { justify-self: end; border-color: oklch(86% 0.05 154); background: var(--mint-soft); }
    .chat-message.assistant { justify-self: start; background: oklch(99.4% 0.008 83); }
    .chat-composer { display: grid; gap: 9px; margin-top: 12px; padding: 11px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
    .chat-composer textarea { min-height: 96px; }
    .file-strip { display: flex; gap: 6px; flex-wrap: wrap; min-height: 28px; }
    .file-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 26px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--soft); color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .context-hint { padding: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--soft); }
    .qr-box { display: grid; place-items: center; min-height: 260px; border: 1px dashed var(--line-strong); border-radius: var(--radius); background: var(--soft); }
    .qr-box img { max-width: 260px; width: 100%; height: auto; border-radius: var(--radius); }
    .modal-backdrop[hidden] { display: none; }
    .modal-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 24px; background: oklch(22% 0.028 245 / .38); animation: modal-fade .16s ease-out; }
    .modal-panel { width: min(860px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: 0 28px 80px oklch(22% 0.028 245 / .22); animation: modal-pop .16s ease-out; }
    .modal-panel .panel-body { padding: 16px; }
    .toast { position: fixed; right: 18px; bottom: 18px; z-index: 10; max-width: min(420px, calc(100vw - 36px)); padding: 10px 12px; border-radius: var(--radius); background: oklch(25% 0.028 245); color: oklch(98% 0.004 230); opacity: 0; transform: translateY(8px); pointer-events: none; transition: opacity .15s ease, transform .15s ease; }
    .toast.show { opacity: 1; transform: translateY(0); }
    @keyframes fade-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes modal-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes modal-pop { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
    @media (max-width: 1120px) { .workspace { grid-template-columns: 1fr; } .sidebar { grid-template-columns: 1fr; } .split, .grid.two, .grid.three, .grid.four { grid-template-columns: 1fr; } .nav { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 680px) { .topbar { align-items: flex-start; flex-direction: column; } .workspace { padding: 10px; } .nav { grid-template-columns: 1fr 1fr; } .form-grid { grid-template-columns: 1fr; } .trigger, .record { grid-template-columns: 1fr; } .trigger-toolbar { align-items: flex-start; flex-direction: column; } .trigger-daybar { grid-template-columns: repeat(4, minmax(0, 1fr)); } .modal-backdrop { padding: 10px; align-items: end; } .modal-panel { width: 100%; max-height: calc(100vh - 20px); } .calendar-grid { gap: 4px; } .cal-day { min-height: 62px; padding: 6px; } }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <h1>Codex Tavern Bridge</h1>
      <div class="brand-sub">\u672c\u5730\u540e\u7aef\u63a7\u5236\u53f0\uff0c\u7ba1\u7406\u5fae\u4fe1\u6865\u63a5\u3001SillyTavern \u6295\u9012\u3001\u65e5\u7a0b\u548c\u961f\u5217\u3002</div>
    </div>
    <div class="top-actions">
      <button type="button" id="refreshButton" class="primary">\u5237\u65b0</button>
      <button type="button" id="modeToggle">\u53d1\u9001\u6a21\u5f0f\uff1a-</button>
      <label>\u5165\u7ad9\u5408\u5e76\u7b49\u5f85 ms <input id="mergeWindowMs" type="number" min="0" step="100"></label>
      <button type="button" id="saveMergeWindow">\u4fdd\u5b58\u7b49\u5f85</button>
      <span class="pill" id="lastUpdated">\u672a\u5237\u65b0</span>
    </div>
  </header>

  <div class="workspace">
    <aside class="sidebar">
      <div class="side-card"><nav class="nav" aria-label="Console navigation" id="sideNav"></nav></div>
      <div class="side-card focus-card">
        <h2>\u5f53\u524d\u7126\u70b9</h2>
        <p id="focusText">\u65e5\u7a0b\u662f\u6838\u5fc3\u4e0a\u4e0b\u6587\uff1a\u89e6\u53d1\u4efb\u52a1\u3001\u5468\u8ba1\u5212\u3001\u5927\u65e5\u5386\u3001\u7528\u6237\u884c\u7a0b\u3001\u89d2\u8272\u884c\u7a0b\u3002</p>
      </div>
    </aside>

    <main class="main">
      <section class="page active" data-page="overview">
        <div class="panel">
          <div class="panel-head"><div class="panel-title"><h2>Overview</h2><p>\u8fd0\u884c\u72b6\u6001\u3001\u5f53\u524d\u8def\u5f84\u548c\u4eca\u65e5\u89e6\u53d1\u6982\u89c8\u3002</p></div></div>
          <div class="panel-body stack">
            <div class="grid four" id="overviewMetrics"></div>
            <div class="grid three" id="moduleCards"></div>
          </div>
        </div>
      </section>

      <section class="page" data-page="schedule">
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title"><h2>Schedule</h2><p>\u4e00\u7b49\u6a21\u5757\uff1a\u89e6\u53d1\u4efb\u52a1\u3001\u5468\u8ba1\u5212\u3001\u5927\u65e5\u5386\u548c\u89d2\u8272\u4e0a\u4e0b\u6587\u3002</p></div>
            <button type="button" id="newTaskButton" class="primary">\u65b0\u5efa\u4efb\u52a1</button>
          </div>
          <div class="tabs" id="scheduleTabs"></div>
          <div class="panel-body">
            <div class="schedule-view" data-schedule-view="trigger"><div class="trigger-shell"><div class="section-note">\u6bcf\u65e5\u89e6\u53d1\u6e05\u5355\uff1a\u968f\u9009\u4e2d\u65e5\u671f\u5207\u6362\uff0c\u53ea\u663e\u793a\u5f53\u5929\u4f1a\u751f\u6548\u7684\u4efb\u52a1\uff1b\u70b9\u51fb\u5c0f\u753b\u7b14\u5728\u5f39\u7a97\u91cc\u4fee\u6539\u5468\u5faa\u73af\u89c4\u5219\u3002</div><div class="trigger-toolbar"><div><h2 id="triggerDateTitle"></h2><p id="triggerDateMeta"></p></div><div class="toolbar"><button type="button" id="prevTriggerDay">\u524d\u4e00\u5929</button><button type="button" id="todayTriggerDay">\u4eca\u5929</button><button type="button" id="nextTriggerDay">\u540e\u4e00\u5929</button></div></div><div class="trigger-daybar" id="triggerDayBar"></div><div class="trigger-list" id="triggerWeekBoard"></div></div></div>
            <div class="schedule-view" data-schedule-view="week" hidden><div class="week-shell"><div class="section-note">\u5468\u8ba1\u5212\u662f\u53ea\u8bfb\u9884\u89c8\uff1a\u4e0d\u5728\u8fd9\u91cc\u4fee\u6539\u89c4\u5219\uff0c\u6240\u6709\u7f16\u8f91\u90fd\u56de\u5230\u89e6\u53d1\u4efb\u52a1\u3002</div><div class="week-board" id="weekBoard"></div></div></div>
            <div class="schedule-view" data-schedule-view="calendar" hidden><div class="split"><div><div class="calendar-head"><div><h2 id="monthLabel"></h2><p>\u6708\u89c6\u56fe\u6807\u51fa\u4eca\u5929\u3001\u5de5\u4f5c/\u4f11\u606f\u65e5\u548c\u4e8b\u9879\u6570\u91cf\u3002</p></div><div class="toolbar"><button type="button" id="prevMonth">\u4e0a\u6708</button><button type="button" id="thisMonth">\u672c\u6708</button><button type="button" id="nextMonth">\u4e0b\u6708</button></div></div><div class="calendar-grid" id="calendarWeekdays"></div><div class="calendar-grid" id="calendarGrid"></div></div><div class="panel"><div class="panel-head"><div class="panel-title"><h2 id="selectedDateTitle">\u672a\u9009\u62e9\u65e5\u671f</h2><p>\u9009\u4e2d\u65e5\u671f\u540e\u76f4\u63a5\u8d34\u4fbf\u7b7e\uff0c\u4fdd\u5b58\u540e\u4f1a\u5728\u6708\u5386\u4e0a\u663e\u793a\u6570\u91cf\u5706\u70b9\u3002</p></div></div><div class="panel-body stack" id="calendarNotesCompact"></div></div></div></div>
            <div class="schedule-view" data-schedule-view="context" hidden><div class="split context-split"><div class="panel"><div class="panel-head"><div class="panel-title"><h2>\u884c\u7a0b\u4e0a\u4e0b\u6587</h2><p>\u50cf\u804a\u5929\u4e00\u6837\u628a\u6587\u5b57\u3001\u56fe\u7247\u6216\u6587\u6863\u6295\u7ed9\u6a21\u578b API\uff0c\u53ea\u505a\u7406\u89e3\u548c\u9884\u89c8\u3002</p></div></div><div class="panel-body"><div class="chat-window"><div class="chat-log" id="agendaChatLog"><div class="chat-message assistant">\u628a\u4f60\u7684\u884c\u7a0b\u3001\u804a\u5929\u7ea6\u5b9a\u3001\u622a\u56fe\u6216\u6587\u6863\u4e22\u8fdb\u6765\u3002\u6211\u4f1a\u5148\u6574\u7406\u6210\u53ef\u6838\u5bf9\u7684\u5019\u9009\u9879\uff0c\u4e0d\u4f1a\u81ea\u52a8\u5199\u5165\u65e5\u5386\u3002</div></div><form class="chat-composer" id="agendaContextForm"><label>\u8f93\u5165\u5185\u5bb9<textarea name="text" id="agendaContextInput" placeholder="5\u670820\u65e5\u665a\u4e0a\u548c\u89d2\u8272\u7ea6\u597d\u4e00\u8d77\u770b\u7535\u5f71\uff0c\u6216\u8005\u4e0a\u4f20\u4e00\u5f20\u884c\u7a0b\u622a\u56fe"></textarea></label><label>\u9644\u4ef6<input type="file" id="agendaContextFiles" multiple accept="image/*,.txt,.md,.json,.csv,.log,.pdf,.doc,.docx"></label><div class="file-strip" id="agendaContextFileList"></div><div class="row"><button class="primary" type="submit">\u53d1\u7ed9 API</button><button type="button" id="clearAgendaContext">\u6e05\u7a7a\u5bf9\u8bdd</button></div></form></div></div></div><div class="panel"><div class="panel-head"><div class="panel-title"><h2>\u89e3\u6790\u9884\u89c8</h2><p>\u6587\u672c\u89e3\u6790\u548c API \u56de\u590d\u90fd\u4f1a\u653e\u5728\u8fd9\u91cc\uff0c\u9700\u624b\u52a8\u786e\u8ba4\u4fdd\u5b58\u3002</p></div></div><div class="panel-body stack"><form class="stack" id="agendaParseForm"><label>\u5f85\u89e3\u6790\u6587\u672c<textarea name="text" placeholder="5\u670820\u65e5\uff0c\u7528\u6237\u7ea6\u5b9a\u4e8b\u9879\uff1a\u665a\u4e0a\u70e4\u8089"></textarea></label><button type="button" id="parseAgendaButton">\u89e3\u6790\u6587\u672c</button></form><div class="context-hint">\u5927\u65e5\u5386\u7684\u8d34\u4fbf\u7b7e\u5165\u53e3\u5df2\u653e\u5230\u6708\u5386\u53f3\u4fa7\uff0c\u8fd9\u91cc\u53ea\u4fdd\u7559\u5bf9\u8bdd\u548c\u9884\u89c8\u3002</div><div id="agendaPreview" class="empty">\u89e3\u6790\u7ed3\u679c\u4f1a\u5728\u8fd9\u91cc\u9884\u89c8\u3002</div></div></div></div></div>
          </div>
        </div>
      </section>

      <section class="page" data-page="queues">
        <div class="panel">
          <div class="panel-head"><div class="panel-title"><h2>Queues</h2><p>\u68c0\u67e5\u5f85\u53d1\u3001\u5ef6\u8fdf\u3001\u5931\u8d25\u548c\u5df2\u53d1\u9001\u7684\u56de\u590d\u8bb0\u5f55\u3002</p></div><div class="toolbar"><button type="button" id="refreshRecords">\u5237\u65b0\u8bb0\u5f55</button><button type="button" data-clear="outbox">\u6e05\u5f85\u53d1</button><button type="button" data-clear="deferred">\u6e05\u5ef6\u8fdf</button><button type="button" data-clear="failed" class="danger">\u6e05\u5931\u8d25</button></div></div>
          <div class="panel-body stack"><div class="grid four" id="queueMetrics"></div><div class="records" id="replyRecords"></div></div>
        </div>
      </section>

      <section class="page" data-page="bots">
        <div class="panel"><div class="panel-head"><div class="panel-title"><h2>Bots</h2><p>Bot \u7ed1\u5b9a\u72ec\u7acb\u7ba1\u7406\uff0c\u53ef\u6307\u5b9a OpenClaw \u6216 UIAuto\u3002</p></div></div><div class="panel-body stack"><form id="botForm" class="form-grid"></form><div class="grid two" id="botList"></div></div></div>
      </section>

      <section class="page" data-page="channels">
        <div class="grid two" id="channelCards"></div>
        <div id="channelDetail" style="margin-top:14px"></div>
      </section>

      <section class="page" data-page="config">
        <div class="grid two">
          <div class="panel"><div class="panel-head"><div class="panel-title"><h2>\u6a21\u578b\u63a5\u5165</h2><p>\u586b Base URL \u548c API Key \u540e\u62c9\u53d6\u6a21\u578b\u76ee\u5f55\u3002</p></div></div><div class="panel-body"><form id="modelForm" class="form-grid"></form></div></div>
          <div class="panel"><div class="panel-head"><div class="panel-title"><h2>\u65e5\u7a0b\u89e3\u6790\u63d0\u793a\u8bcd</h2><p>\u628a\u81ea\u7136\u8bed\u8a00\u65e5\u7a0b\u89e3\u6790\u6210\u540e\u7aef\u53ef\u7528\u683c\u5f0f\u3002</p></div></div><div class="panel-body"><form id="parserForm" class="form-grid"></form></div></div>
        </div>
        <div class="panel"><div class="panel-head"><div class="panel-title"><h2>\u914d\u7f6e\u5feb\u7167</h2><p>\u7528\u4e8e\u6392\u67e5\uff0c\u4e0d\u663e\u793a API Key \u660e\u6587\u3002</p></div></div><div class="panel-body"><pre id="configSnapshot"></pre></div></div>
      </section>
    </main>
  </div>
  <div class="modal-backdrop" id="taskModal" hidden>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="taskModalTitle">
      <div class="panel-head">
        <div class="panel-title"><h2 id="taskModalTitle">\u4efb\u52a1\u7f16\u8f91</h2><p>\u8fd9\u91cc\u53ea\u4fee\u6539\u5468\u5faa\u73af\u89e6\u53d1\u4efb\u52a1\uff0c\u4e0d\u5f71\u54cd\u5927\u65e5\u5386\u7684\u65e5\u671f\u7ea7\u4efb\u52a1\u3002</p></div>
        <button type="button" class="ghost" id="closeTaskModal">\u5173\u95ed</button>
      </div>
      <div class="panel-body"><form class="form-grid" id="taskForm"></form></div>
    </div>
  </div>
  <div class="toast" id="toast"></div>

  <script>
    const mainPages = {
      overview: { label: "Overview", icon: "\\u25cf", count: "OK", focus: "\\u5f53\\u524d\\u8def\\u5f84\\u3001\\u961f\\u5217\\u3001Bot \\u548c\\u4eca\\u65e5\\u89e6\\u53d1\\u4efb\\u52a1\\u3002" },
      schedule: { label: "Schedule", icon: "\\u25cc", count: "0", focus: "\\u89e6\\u53d1\\u4efb\\u52a1\\u3001\\u5468\\u8ba1\\u5212\\u3001\\u5927\\u65e5\\u5386\\u548c\\u884c\\u7a0b\\u4e0a\\u4e0b\\u6587\\u3002" },
      queues: { label: "Queues", icon: "\\u21bb", count: "0", focus: "\\u5f85\\u53d1\\u3001\\u5ef6\\u8fdf\\u3001\\u5931\\u8d25\\u548c\\u5df2\\u53d1\\u9001\\u8bb0\\u5f55\\u3002" },
      bots: { label: "Bots", icon: "\\u25c7", count: "0", focus: "\\u673a\\u5668\\u4eba\\u7ed1\\u5b9a\\u548c\\u6295\\u9012\\u76ee\\u6807\\u3002" },
      channels: { label: "Channels", icon: "\\u25a3", count: "2", focus: "OpenClaw \\u548c UIAuto/VM \\u4e24\\u6761\\u5fae\\u4fe1\\u8def\\u5f84\\u3002" },
      config: { label: "Config", icon: "\\u2318", count: "JSON", focus: "\\u6a21\\u578b\\u76ee\\u5f55\\u3001\\u65e5\\u7a0b\\u89e3\\u6790\\u548c\\u914d\\u7f6e\\u5feb\\u7167\\u3002" }
    };
    const scheduleTabs = {
      trigger: "\\u89e6\\u53d1\\u4efb\\u52a1",
      week: "\\u5468\\u8ba1\\u5212",
      calendar: "\\u5927\\u65e5\\u5386",
      context: "\\u884c\\u7a0b\\u4e0a\\u4e0b\\u6587"
    };
    const weekdays = [
      { id: 1, short: "\\u5468\\u4e00", long: "\\u661f\\u671f\\u4e00" },
      { id: 2, short: "\\u5468\\u4e8c", long: "\\u661f\\u671f\\u4e8c" },
      { id: 3, short: "\\u5468\\u4e09", long: "\\u661f\\u671f\\u4e09" },
      { id: 4, short: "\\u5468\\u56db", long: "\\u661f\\u671f\\u56db" },
      { id: 5, short: "\\u5468\\u4e94", long: "\\u661f\\u671f\\u4e94" },
      { id: 6, short: "\\u5468\\u516d", long: "\\u661f\\u671f\\u516d" },
      { id: 7, short: "\\u5468\\u65e5", long: "\\u661f\\u671f\\u65e5" }
    ];
    const $ = (id) => document.getElementById(id);
    let state = { data: null, replies: [], active: "overview", scheduleTab: "trigger", channelMode: "", month: new Date(), selectedDate: dateKey(new Date()), triggerDate: dateKey(new Date()), modelChoices: [], agendaPreview: [] };

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }
    function toast(message) {
      const el = $("toast");
      el.textContent = message;
      el.classList.add("show");
      window.clearTimeout(toast.timer);
      toast.timer = window.setTimeout(() => el.classList.remove("show"), 2400);
    }
    async function api(path, options) {
      const response = await fetch(path, options);
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
      if (!response.ok || payload.ok === false) throw new Error(payload.error || response.statusText);
      return payload;
    }
    async function refresh() {
      try {
        state.data = await api("/api/status");
        $("lastUpdated").textContent = "\\u5237\\u65b0 " + new Date().toLocaleTimeString();
        $("mergeWindowMs").value = state.data.wechat?.inbound_merge_window_ms ?? 10000;
        $("modeToggle").dataset.mode = state.data.delivery?.message_mode || "split";
        $("modeToggle").textContent = "\\u53d1\\u9001\\u6a21\\u5f0f\\uff1a" + (state.data.delivery?.message_mode === "single" ? "\\u5408\\u5e76" : "\\u6309 <message> \\u5206\\u6761");
        renderAll();
      } catch (error) {
        toast("\\u5237\\u65b0\\u5931\\u8d25\\uff1a" + error.message);
      }
    }
    function renderAll() {
      const data = state.data || {};
      renderNav(data);
      renderOverview(data);
      renderChannels(data);
      renderSchedule(data);
      renderQueues(data);
      renderBots(data);
      renderConfig(data);
      renderSnapshot(data);
    }
    function setPage(name) {
      state.active = name;
      document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.dataset.page === name));
      $("focusText").textContent = mainPages[name]?.focus || "";
      renderNav(state.data || {});
      renderAll();
    }
    function renderNav(data) {
      const counts = {
        overview: "OK",
        schedule: todayTasks(data).length,
        queues: queueValue(data, "failed") || queueValue(data, "outbox") + queueValue(data, "deferred"),
        bots: (data.bots || []).length,
        channels: currentTransport(data) === "uiauto" ? "UI" : "OC",
        config: "JSON"
      };
      $("sideNav").innerHTML = Object.entries(mainPages).map(([key, page]) => '<button type="button" data-page-button="' + key + '" class="' + (state.active === key ? "active" : "") + '"><span>' + page.icon + '</span><span>' + page.label + '</span><span class="nav-kicker">' + escapeHtml(counts[key]) + '</span></button>').join("");
    }
    function currentTransport(data) {
      if (state.channelMode === "openclaw" || state.channelMode === "uiauto") return state.channelMode;
      const explicit = (data.bots || []).find((bot) => bot.enabled !== false && bot.wechat_transport);
      if (explicit?.wechat_transport === "uiauto") return "uiauto";
      if (explicit?.wechat_transport === "openclaw") return "openclaw";
      if ((data.uiauto_accounts || []).some((account) => account.enabled !== false)) return "uiauto";
      return "openclaw";
    }
    function transportLabel(mode) { return mode === "uiauto" ? "UIAuto" : "OpenClaw"; }
    function queueValue(data, key) { return Number((data.queues || {})[key] || 0); }
    function todayWeekdayId(date = new Date()) {
      const day = date.getDay();
      return day === 0 ? 7 : day;
    }
    function isTaskForDay(task, dayId) {
      if (task.date_key) return false;
      return !task.days || !task.days.length || task.days.includes(dayId);
    }
    function isRecurringTask(task) {
      return !task.date_key;
    }
    function recurringTasks(data) {
      return (data.tasks || []).filter(isRecurringTask).sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)));
    }
    function dateSpecificTasks(data, key) {
      return (data.tasks || []).filter((task) => task.date_key === key).sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)));
    }
    function taskSortKey(task) {
      return task.schedule_mode === "daily_random" ? (task.random_window_start || "09:00") : (task.time || "99:99");
    }
    function todayTasks(data) {
      const dayId = todayWeekdayId();
      const today = dateKey(new Date());
      return (data.tasks || []).filter((task) => task.date_key === today || isTaskForDay(task, dayId)).sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)));
    }
    function renderOverview(data) {
      const mode = currentTransport(data);
      const bots = data.bots || [];
      const tasks = data.tasks || [];
      const failed = queueValue(data, "failed");
      const waiting = queueValue(data, "outbox") + queueValue(data, "deferred");
      $("overviewMetrics").innerHTML = [
        metric("\\u5f53\\u524d\\u8def\\u5f84", transportLabel(mode), mode === "uiauto" ? "UIAuto/VM worker" : "OpenClaw bot", mode === "uiauto" ? "warn" : "ok"),
        metric("\\u4eca\\u65e5\\u89e6\\u53d1", todayTasks(data).length, "\\u4ec5\\u5217\\u51fa\\u4eca\\u65e5\\u5e94\\u89e6\\u53d1\\u7684\\u4efb\\u52a1", "ok"),
        metric("\\u961f\\u5217\\u72b6\\u6001", failed ? failed + " \\u5931\\u8d25" : waiting ? waiting + " \\u5f85\\u5904\\u7406" : "\\u6b63\\u5e38", "\\u5f85\\u53d1 " + queueValue(data, "outbox") + " / \\u5ef6\\u8fdf " + queueValue(data, "deferred"), failed ? "bad" : waiting ? "warn" : "ok"),
        metric("Bot", bots.filter((bot) => bot.enabled !== false).length + " / " + bots.length, "\\u5df2\\u542f\\u7528 / \\u603b\\u6570", bots.length ? "ok" : "warn")
      ].join("");
      const modules = [
        ["schedule", "Schedule", "\\u89e6\\u53d1\\u4efb\\u52a1\\u3001\\u5468\\u8ba1\\u5212\\u3001\\u5927\\u65e5\\u5386\\u548c\\u884c\\u7a0b\\u4e0a\\u4e0b\\u6587\\u3002", todayTasks(data).length + " \\u4eca\\u65e5"],
        ["channels", "Channels", "\\u5207\\u6362 OpenClaw \\u6216 UIAuto/VM\\uff0c\\u914d\\u7f6e\\u626b\\u7801\\u548c worker\\u3002", transportLabel(mode)],
        ["queues", "Queues", "\\u67e5\\u770b\\u53d1\\u9001\\u3001\\u5931\\u8d25\\u548c\\u91cd\\u8bd5\\u3002", failed ? failed + " \\u5931\\u8d25" : "\\u6b63\\u5e38"],
        ["bots", "Bots", "\\u7ef4\\u62a4\\u673a\\u5668\\u4eba\\u7ed1\\u5b9a\\u548c\\u89d2\\u8272\\u76ee\\u6807\\u3002", bots.length + " \\u4e2a"],
        ["config", "Config", "\\u6a21\\u578b\\u76ee\\u5f55\\u3001\\u63d0\\u793a\\u8bcd\\u548c\\u914d\\u7f6e\\u5feb\\u7167\\u3002", (data.model_api && data.model_api.enabled) ? "\\u5df2\\u542f\\u7528" : "\\u672a\\u542f\\u7528"]
      ];
      $("moduleCards").innerHTML = modules.map((item) => '<button type="button" class="module-card" data-page-button="' + item[0] + '"><div class="module-title">' + item[1] + '<span class="pill">' + item[3] + '</span></div><div class="module-meta">' + item[2] + '</div></button>').join("");
    }
    function metric(label, value, note, tone) {
      return '<div class="metric ' + (tone || "") + '"><div class="metric-label">' + escapeHtml(label) + '</div><div class="metric-value">' + escapeHtml(value) + '</div><div class="metric-note">' + escapeHtml(note) + '</div></div>';
    }
    function renderSchedule(data) {
      renderScheduleTabs(state.scheduleTab);
      document.querySelectorAll(".schedule-view").forEach((view) => { view.hidden = view.dataset.scheduleView !== state.scheduleTab; });
      renderTriggerTasks(data);
      renderWeekPlan(data);
      renderCalendar(data);
      renderSelectedNotes(data);
    }
    function renderScheduleTabs(activeTab) {
      $("scheduleTabs").innerHTML = Object.entries(scheduleTabs).map(([key, label]) => '<button type="button" data-schedule-tab="' + key + '" class="' + (activeTab === key ? "active" : "") + '">' + label + '</button>').join("");
    }
    function renderTriggerTasks(data) {
      if (!$("triggerWeekBoard")) return;
      const key = state.triggerDate || dateKey(new Date());
      const date = dateFromKey(key);
      const dayId = todayWeekdayId(date);
      const day = weekdays[dayId - 1];
      const recurring = recurringTasks(data).filter((task) => isTaskForDay(task, dayId));
      const extra = dateSpecificTasks(data, key);
      const tasks = recurring.concat(extra).sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)));
      if ($("triggerDateTitle")) $("triggerDateTitle").textContent = formatDateHeading(date) + " " + day.long;
      if ($("triggerDateMeta")) $("triggerDateMeta").textContent = (key === dateKey(new Date()) ? "\\u4eca\\u65e5" : "\\u9009\\u4e2d\\u65e5") + " / \\u5468\\u5faa\\u73af " + recurring.length + " / \\u65e5\\u671f\\u989d\\u5916 " + extra.length;
      if ($("triggerDayBar")) $("triggerDayBar").innerHTML = renderTriggerDayBar(key);
      $("triggerWeekBoard").innerHTML = tasks.length ? tasks.map((task) => renderTriggerTask(task, dayId)).join("") : '<div class="empty">\\u8fd9\\u4e00\\u5929\\u6ca1\\u6709\\u9700\\u8981\\u89e6\\u53d1\\u7684\\u4efb\\u52a1\\u3002</div>';
    }
    function renderTriggerTask(task, dayId) {
      const enabled = task.enabled !== false;
      const dateTask = Boolean(task.date_key);
      const status = enabled ? "\\u542f\\u7528" : "\\u6682\\u505c";
      const source = dateTask ? "\\u65e5\\u671f\\u989d\\u5916" : "\\u5468\\u5faa\\u73af";
      return '<div class="trigger ' + (enabled ? "" : "paused") + '"><button type="button" class="close-btn" title="\\u5220\\u9664" aria-label="\\u5220\\u9664" data-task-delete="' + encodeURIComponent(task.id) + '">&times;</button><div class="trigger-timebox"><div class="task-time">' + escapeHtml(displayTaskTime(task)) + '</div><div class="trigger-source">' + status + '</div></div><div class="trigger-main"><div class="item-title">' + escapeHtml(task.task || "") + '</div><div class="item-meta">' + escapeHtml(task.bot_id || "\\u9ed8\\u8ba4 Bot") + " / " + escapeHtml(task.delivery_channel || "wechat") + " / " + escapeHtml(task.wechat_transport || "auto") + '</div><div class="trigger-source">' + source + '</div></div><div class="trigger-actions"><button type="button" class="icon-btn" title="\\u7f16\\u8f91" aria-label="\\u7f16\\u8f91" data-task-edit="' + encodeURIComponent(task.id) + '">&#9998;</button><button type="button" class="switch-btn ' + (enabled ? "on" : "") + '" title="' + (enabled ? "\\u6682\\u505c" : "\\u542f\\u7528") + '" aria-label="' + (enabled ? "\\u6682\\u505c" : "\\u542f\\u7528") + '" data-task-toggle="' + encodeURIComponent(task.id) + '"></button></div></div>';
    }
    function renderTriggerDayBar(selectedKey) {
      const selected = dateFromKey(selectedKey);
      const today = dateKey(new Date());
      const start = new Date(selected);
      start.setDate(selected.getDate() - 3);
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const key = dateKey(d);
        const day = weekdays[todayWeekdayId(d) - 1];
        days.push('<button type="button" class="trigger-day ' + (key === selectedKey ? "active " : "") + (key === today ? "today" : "") + '" data-trigger-date="' + key + '"><span class="trigger-day-date">' + (d.getMonth() + 1) + "/" + d.getDate() + '</span><span class="trigger-day-week">' + day.short + '</span></button>');
      }
      return days.join("");
    }
    function renderWeekPlan(data) {
      if (!$("weekBoard")) return;
      const tasks = recurringTasks(data);
      const rows = weekTimeRows(tasks);
      $("weekBoard").className = "timetable";
      $("weekBoard").innerHTML =
        '<div class="timetable-cell timetable-head">\\u65f6\\u95f4</div>' +
        weekdays.map((day) => '<div class="timetable-cell timetable-head">' + day.short + '</div>').join("") +
        (rows.length ? rows.map((row) => {
          return '<div class="timetable-cell timetable-time">' + escapeHtml(row.label) + '</div>' +
            weekdays.map((day) => {
              const dayTasks = tasks.filter((task) => taskSortKey(task) === row.key && isTaskForDay(task, day.id));
              return '<div class="timetable-cell timetable-slot ' + (day.id >= 6 ? "weekend" : "") + '">' + (dayTasks.length ? dayTasks.map((task) => renderCourseChip(task)).join("") : "") + '</div>';
            }).join("");
        }).join("") : '<div class="timetable-cell timetable-slot" style="grid-column:1 / -1"><div class="empty">\\u8fd8\\u6ca1\\u6709\\u53ef\\u9884\\u89c8\\u7684\\u5468\\u5faa\\u73af\\u4efb\\u52a1</div></div>');
    }
    function weekTimeRows(tasks) {
      const map = new Map();
      tasks.forEach((task) => {
        const key = taskSortKey(task);
        if (!map.has(key)) map.set(key, { key, label: displayTaskTime(task) });
      });
      return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
    }
    function renderCourseChip(task) {
      const enabled = task.enabled !== false;
      return '<div class="course-chip ' + (enabled ? "" : "paused") + '"><div class="course-chip-title">' + escapeHtml(task.task || "") + '</div><div class="course-chip-meta">' + escapeHtml(displayTaskTime(task)) + " / " + escapeHtml(task.bot_id || "\\u9ed8\\u8ba4 Bot") + '</div><div class="course-chip-meta">' + escapeHtml(task.delivery_channel || "wechat") + '</div></div>';
    }
    function displayTaskTime(task) {
      return task.schedule_mode === "daily_random" ? (task.random_window_start || "09:00") + "-" + (task.random_window_end || "22:30") + " \\u968f\\u673a" : (task.time || "--:--");
    }
    function renderTask(task) {
      const enabled = task.enabled !== false;
      return '<div class="task ' + (enabled ? "" : "paused") + '"><button type="button" class="close-btn" title="\\u5220\\u9664" aria-label="\\u5220\\u9664" data-task-delete="' + encodeURIComponent(task.id) + '">&times;</button><div class="task-time">' + escapeHtml(displayTaskTime(task)) + '</div><div class="item-title">' + escapeHtml(task.task || "") + '</div><div class="item-meta">' + escapeHtml(task.bot_id || "\\u9ed8\\u8ba4 Bot") + " / " + escapeHtml(task.delivery_channel || "wechat") + '</div><div class="task-actions"><button type="button" class="icon-btn" title="\\u7f16\\u8f91" aria-label="\\u7f16\\u8f91" data-task-edit="' + encodeURIComponent(task.id) + '">&#9998;</button><button type="button" class="switch-btn ' + (enabled ? "on" : "") + '" title="' + (enabled ? "\\u6682\\u505c" : "\\u542f\\u7528") + '" aria-label="' + (enabled ? "\\u6682\\u505c" : "\\u542f\\u7528") + '" data-task-toggle="' + encodeURIComponent(task.id) + '"></button></div></div>';
    }
    function renderWeekPreviewTask(task, dayId) {
      const enabled = task.enabled !== false;
      const activeForDay = isTaskForDay(task, dayId);
      return '<div class="task readonly ' + (enabled ? "" : "paused ") + (activeForDay ? "" : "inactive-day") + '"><div class="task-time">' + escapeHtml(displayTaskTime(task)) + '</div><div class="item-title">' + escapeHtml(task.task || "") + '</div><div class="item-meta">' + (activeForDay ? "\\u672c\\u65e5\\u89e6\\u53d1" : "\\u672c\\u65e5\\u53d6\\u6d88") + " / " + escapeHtml(task.delivery_channel || "wechat") + '</div></div>';
    }
    function renderTaskForm(data, task) {
      if (!$("taskForm")) return;
      const t = task || {};
      if ($("taskModalTitle")) $("taskModalTitle").textContent = t.id ? (t.date_key ? "\\u7f16\\u8f91\\u65e5\\u671f\\u989d\\u5916\\u4efb\\u52a1" : "\\u7f16\\u8f91\\u89e6\\u53d1\\u4efb\\u52a1") : "\\u65b0\\u5efa\\u89e6\\u53d1\\u4efb\\u52a1";
      $("taskForm").innerHTML =
        input("id", "ID", t.id || "") +
        select("bot_id", "Bot", botOptions(data, t.bot_id)) +
        '<label><span>\\u65f6\\u95f4</span><input name="time" type="time" value="' + escapeHtml(t.time || "20:00") + '"></label>' +
        '<label><span>\\u6a21\\u5f0f</span><select name="schedule_mode"><option value="fixed"' + (t.schedule_mode !== "daily_random" ? " selected" : "") + '>\\u56fa\\u5b9a</option><option value="daily_random"' + (t.schedule_mode === "daily_random" ? " selected" : "") + '>\\u968f\\u673a</option></select></label>' +
        input("random_window_start", "\\u968f\\u673a\\u5f00\\u59cb", t.random_window_start || "09:00", "time") +
        input("random_window_end", "\\u968f\\u673a\\u7ed3\\u675f", t.random_window_end || "22:30", "time") +
        select("delivery_channel", "\\u6295\\u9012", '<option value="wechat"' + (t.delivery_channel !== "tavern" ? " selected" : "") + '>WeChat</option><option value="tavern"' + (t.delivery_channel === "tavern" ? " selected" : "") + '>Tavern</option>') +
        select("wechat_transport", "\\u5fae\\u4fe1\\u8def\\u5f84", '<option value="auto">Auto</option><option value="openclaw"' + (t.wechat_transport === "openclaw" ? " selected" : "") + '>OpenClaw</option><option value="uiauto"' + (t.wechat_transport === "uiauto" ? " selected" : "") + '>UIAuto</option>') +
        '<label class="span"><span>\\u6267\\u884c\\u65e5</span><div class="day-checks">' + weekdays.map((day) => '<label class="check-tile"><input type="checkbox" name="days" value="' + day.id + '"' + (!t.days || !t.days.length || t.days.includes(day.id) ? " checked" : "") + '>' + day.short + '</label>').join("") + '</div></label>' +
        '<label class="span"><span>\\u4efb\\u52a1</span><textarea name="task">' + escapeHtml(t.task || "") + '</textarea></label>' +
        '<label class="span"><span>Intent</span><textarea name="intent">' + escapeHtml(t.intent || "\\u6e29\\u548c\\u63d0\\u9192\\uff0c\\u4ec5\\u4f9b\\u53c2\\u8003") + '</textarea></label>' +
        input("target_character", "\\u89d2\\u8272", t.target_character || "") +
        input("conversation_id", "\\u4f1a\\u8bdd ID", t.conversation_id || "") +
        input("timezone", "\\u65f6\\u533a", t.timezone || "Asia/Shanghai") +
        '<div class="span row"><button class="primary" type="button" data-task-save="1">\\u4fdd\\u5b58\\u4efb\\u52a1</button><button type="button" id="resetTaskForm">\\u6e05\\u7a7a</button></div>';
    }
    function renderCalendar(data) {
      if (!$("calendarGrid")) return;
      $("calendarWeekdays").innerHTML = weekdays.map((d) => '<div class="cal-weekday">' + d.short + '</div>').join("");
      const entries = ((data.agenda || {}).entries || []);
      const tasks = data.tasks || [];
      const month = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
      $("monthLabel").textContent = month.getFullYear() + "\\u5e74" + (month.getMonth() + 1) + "\\u6708";
      const today = dateKey(new Date());
      const first = new Date(month);
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(first);
        d.setDate(first.getDate() + i);
        const key = dateKey(d);
        const counts = entryCounts(entries, key, d);
        const taskCount = dateSpecificTasks({ tasks }, key).length;
        const outside = d.getMonth() !== month.getMonth();
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        const isToday = key === today;
        cells.push('<button type="button" class="cal-day ' + (outside ? "outside " : "") + (weekend ? "weekend " : "") + (isToday ? "today " : "") + (state.selectedDate === key ? "selected" : "") + '" data-date="' + key + '"><span class="cal-num">' + d.getDate() + '</span><span class="cal-tag ' + (isToday ? "today" : "") + '">' + (isToday ? "\\u4eca\\u5929" : (weekend ? "\\u4f11\\u606f" : "\\u5de5\\u4f5c")) + '</span><span class="cal-dots">' + (taskCount ? '<span class="count-dot task">' + taskCount + '</span>' : '') + (counts.user ? '<span class="count-dot user">' + counts.user + '</span>' : '') + (counts.role ? '<span class="count-dot role">' + counts.role + '</span>' : '') + '</span></button>');
      }
      $("calendarGrid").innerHTML = cells.join("");
      renderSelectedNotes(data);
    }
    function dateKey(date) { return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0"); }
    function dateFromKey(key) {
      const parts = String(key || "").split("-").map(Number);
      if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return new Date();
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    function shiftDateKey(key, offset) {
      const date = dateFromKey(key);
      date.setDate(date.getDate() + offset);
      return dateKey(date);
    }
    function formatDateHeading(date) {
      return date.getFullYear() + "\\u5e74" + (date.getMonth() + 1) + "\\u6708" + date.getDate() + "\\u65e5";
    }
    function entryKey(entry, fallbackDate) {
      if (entry.date_key) return entry.date_key;
      const text = String(entry.date_text || "");
      const m = text.match(/(\\d{1,2})\\D+(\\d{1,2})/);
      if (m) return fallbackDate.getFullYear() + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
      return "";
    }
    function entryCounts(entries, key, date) {
      return entries.reduce((acc, entry) => {
        if (entryKey(entry, date) === key) {
          if (entry.owner === "character") acc.role += 1;
          else acc.user += 1;
        }
        return acc;
      }, { user: 0, role: 0 });
    }
    function renderSelectedNotes(data) {
      const entries = ((data.agenda || {}).entries || []);
      const tasks = data.tasks || [];
      const date = new Date(state.selectedDate + "T00:00:00");
      const dateText = (date.getMonth() + 1) + "\\u6708" + date.getDate() + "\\u65e5";
      if ($("selectedDateTitle")) $("selectedDateTitle").textContent = dateText;
      if ($("agendaDateText")) $("agendaDateText").value = (date.getMonth() + 1) + "\\u6708" + date.getDate() + "\\u65e5";
      const items = entries.filter((entry) => entryKey(entry, date) === state.selectedDate);
      const users = items.filter((entry) => entry.owner !== "character");
      const roles = items.filter((entry) => entry.owner === "character");
      const dateTasks = dateSpecificTasks({ tasks }, state.selectedDate);
      if ($("userNotes")) $("userNotes").innerHTML = users.length ? users.map(renderNote).join("") : '<div class="empty">\\u8fd9\\u5929\\u6682\\u65e0\\u7528\\u6237\\u9884\\u5b9a\\u3002</div>';
      if ($("roleNotes")) $("roleNotes").innerHTML = roles.length ? roles.map(renderNote).join("") : '<div class="empty">\\u8fd9\\u5929\\u6682\\u65e0\\u89d2\\u8272\\u9884\\u5b9a\\u3002</div>';
      if ($("calendarNotesCompact")) $("calendarNotesCompact").innerHTML =
        '<form class="sticky-form" id="calendarAgendaForm">' +
          '<label>\\u7c7b\\u578b<select name="owner"><option value="user">\\u7528\\u6237\\u9884\\u5b9a</option><option value="character">\\u89d2\\u8272\\u9884\\u5b9a</option></select></label>' +
          '<input type="hidden" name="date_text" value="' + escapeHtml(dateText) + '">' +
          '<label>\\u8d34\\u7ed9 ' + escapeHtml(dateText) + '<textarea name="item" placeholder="\\u5199\\u4e0b\\u5f53\\u5929\\u8981\\u8bb0\\u4f4f\\u7684\\u5b89\\u6392"></textarea></label>' +
          '<button class="primary" type="submit">\\u8d34\\u4e0a\\u4fbf\\u7b7e</button>' +
        '</form>' +
        '<form class="sticky-form" id="calendarDateTaskForm">' +
          '<input type="hidden" name="date_key" value="' + escapeHtml(state.selectedDate) + '">' +
          '<label>\\u5f53\\u65e5\\u989d\\u5916\\u89e6\\u53d1\\u65f6\\u95f4<input name="time" type="time" value="20:00"></label>' +
          '<label>\\u89e6\\u53d1\\u5185\\u5bb9<textarea name="task" placeholder="\\u53ea\\u5728\\u8fd9\\u4e00\\u5929\\u89e6\\u53d1\\u7684\\u989d\\u5916\\u4efb\\u52a1"></textarea></label>' +
          '<input type="hidden" name="schedule_mode" value="fixed">' +
          '<input type="hidden" name="delivery_channel" value="wechat">' +
          '<input type="hidden" name="wechat_transport" value="auto">' +
          '<button class="primary" type="submit">\\u6dfb\\u52a0\\u5f53\\u65e5\\u89e6\\u53d1</button>' +
        '</form>' +
        '<div><h3>\\u5f53\\u65e5\\u989d\\u5916\\u89e6\\u53d1</h3><div class="note-list">' + (dateTasks.length ? dateTasks.map(renderDateTaskNote).join("") : '<div class="empty">\\u8fd8\\u6ca1\\u6709\\u65e5\\u671f\\u7ea7\\u89e6\\u53d1\\u3002</div>') + '</div></div>' +
        '<div><h3>\\u7528\\u6237\\u9884\\u5b9a</h3><div class="note-list">' + (users.length ? users.map(renderNote).join("") : '<div class="empty">\\u8fd8\\u6ca1\\u6709\\u4fbf\\u7b7e\\u3002</div>') + '</div></div>' +
        '<div><h3>\\u89d2\\u8272\\u9884\\u5b9a</h3><div class="note-list">' + (roles.length ? roles.map(renderNote).join("") : '<div class="empty">\\u8fd8\\u6ca1\\u6709\\u4fbf\\u7b7e\\u3002</div>') + '</div></div>';
    }
    function renderDateTaskNote(task) {
      return '<div class="note user"><div class="item-head"><div><div class="task-time">' + escapeHtml(displayTaskTime(task)) + '</div>' + escapeHtml(task.task || "") + '<div class="item-meta">\\u65e5\\u671f\\u7ea7\\u989d\\u5916\\u89e6\\u53d1</div></div><button type="button" class="ghost" data-task-delete="' + encodeURIComponent(task.id) + '">\\u5220\\u9664</button></div></div>';
    }
    function renderNote(entry) {
      return '<div class="note ' + (entry.owner === "character" ? "role" : "user") + '"><div class="item-head"><div>' + escapeHtml(entry.item || entry.text || "") + '<div class="item-meta">' + escapeHtml(entry.date_text || "") + '</div></div><button type="button" class="ghost" data-agenda-delete="' + encodeURIComponent(entry.id) + '">\\u5220\\u9664</button></div></div>';
    }
    function renderChannels(data) {
      if (!$("channelCards")) return;
      const mode = currentTransport(data);
      $("channelCards").innerHTML = [
        channelCard("openclaw", "OpenClaw", "\\u5b98\\u65b9 Bot \\u5165\\u53e3\\uff0c\\u9002\\u5408\\u63a5\\u53e3\\u5316\\u7684\\u7a33\\u5b9a\\u8def\\u7531\\u3002", (data.wechat_accounts || []).length + " \\u4e2a\\u8d26\\u53f7", mode),
        channelCard("uiauto", "UIAuto/VM", "\\u771f\\u5b9e\\u5c0f\\u53f7\\u8def\\u7ebf\\uff0c\\u4ec5\\u901a\\u8fc7\\u8fdc\\u7a0b worker URL \\u5bf9\\u63a5\\u3002", (data.uiauto_accounts || []).length + " \\u4e2a worker", mode)
      ].join("");
      $("channelDetail").innerHTML = mode === "uiauto" ? renderUiautoPanel(data) : renderOpenClawPanel(data);
    }
    function channelCard(id, title, meta, note, active) {
      return '<button type="button" class="module-card ' + (active === id ? "active" : "") + '" data-channel="' + id + '"><div class="module-title">' + title + '<span class="pill">' + note + '</span></div><div class="module-meta">' + meta + '</div></button>';
    }
    function renderOpenClawPanel(data) {
      const accounts = data.wechat_accounts || [];
      return '<div class="panel"><div class="panel-head"><div class="panel-title"><h2>OpenClaw</h2><p>\\u626b\\u7801\\u767b\\u5f55\\u540e\\u4f1a\\u81ea\\u52a8\\u4fdd\\u5b58\\u8d26\\u53f7\\uff0c\\u5e76\\u7ed1\\u5b9a\\u5230\\u9ed8\\u8ba4 Bot\\u3002</p></div><button class="primary" type="button" id="startOpenClawLogin">\\u5f00\\u59cb\\u626b\\u7801</button></div><div class="panel-body grid two"><div class="qr-box" id="qrBox">\\u5c1a\\u672a\\u5f00\\u59cb\\u626b\\u7801</div><div><h3>\\u5df2\\u4fdd\\u5b58\\u8d26\\u53f7</h3><div class="stack" style="margin-top:10px">' + (accounts.length ? accounts.map((account) => renderOpenClawAccountItem(account, data)).join("") : '<div class="empty">\\u6682\\u65e0 OpenClaw \\u8d26\\u53f7\\u3002</div>') + '</div></div></div></div>';
    }
    function renderOpenClawAccountItem(account, data) {
      const id = String(account.id || account.account_id || "");
      const bound = (data.bots || []).filter((bot) => bot.wechat_account_id === id).map((bot) => bot.name || bot.id);
      return '<div class="item"><div class="item-head"><div><div class="item-title">' + escapeHtml(id || "-") + '</div><div class="item-meta">' + escapeHtml(account.user_id || account.base_url || "") + '</div><div class="item-meta">' + (bound.length ? "\\u5df2\\u7ed1\\u5b9a\\uff1a" + escapeHtml(bound.join(", ")) : "\\u672a\\u7ed1\\u5b9a Bot") + '</div></div><div class="row"><button type="button" data-openclaw-bind="' + encodeURIComponent(id) + '">\\u7ed1\\u5b9a\\u9ed8\\u8ba4 Bot</button><button type="button" class="danger" data-openclaw-delete="' + encodeURIComponent(id) + '">\\u5220\\u9664</button></div></div></div>';
    }
    function renderUiautoPanel(data) {
      const accounts = data.uiauto_accounts || [];
      const account = accounts[0] || {};
      return '<div class="panel"><div class="panel-head"><div class="panel-title"><h2>UIAuto/VM</h2><p>\\u4e3b\\u7cfb\\u7edf\\u4e0d\\u76f4\\u63a5\\u63a7\\u5236\\u5fae\\u4fe1\\uff0c\\u53ea\\u8c03\\u7528 VM worker \\u7684 HTTP \\u80fd\\u529b\\u3002</p></div><button type="button" id="checkUiautoWorker">\\u5065\\u5eb7\\u68c0\\u67e5</button></div><div class="panel-body"><form id="uiautoForm" class="form-grid">' +
        input("id", "ID", account.id || "windows_alt_1") +
        input("worker_base_url", "Worker URL", account.worker_base_url || "http://127.0.0.1:8795") +
        input("owner_contact_name", "\\u76ee\\u6807\\u8054\\u7cfb\\u4eba", account.owner_contact_name || "") +
        select("bot_id", "Bot", botOptions(data, account.bot_id)) +
        input("target_character", "\\u89d2\\u8272", account.target_character || "") +
        input("conversation_id", "\\u4f1a\\u8bdd ID", account.conversation_id || "") +
        input("language", "\\u8bed\\u8a00", account.language || "zh-CN") +
        input("poll_interval_ms", "\\u8f6e\\u8be2\\u95f4\\u9694(ms)", account.poll_interval_ms || "1500", "number") +
        '<label><span>\\u542f\\u7528</span><select name="enabled"><option value="true"' + (account.enabled !== false ? " selected" : "") + '>\\u542f\\u7528</option><option value="false"' + (account.enabled === false ? " selected" : "") + '>\\u505c\\u7528</option></select></label>' +
        '<div class="span row"><button class="primary" type="submit">\\u4fdd\\u5b58 UIAuto</button><button type="button" id="loadUiautoSessions">\\u62c9\\u53d6\\u4f1a\\u8bdd</button><span class="pill" id="uiautoResult">-</span></div></form><div class="stack" style="margin-top:12px" id="uiautoSessions"></div></div></div>';
    }
    function input(name, label, value, type) {
      return '<label><span>' + label + '</span><input name="' + name + '" type="' + (type || "text") + '" value="' + escapeHtml(value || "") + '"></label>';
    }
    function select(name, label, options) {
      return '<label><span>' + label + '</span><select name="' + name + '">' + options + '</select></label>';
    }
    function botOptions(data, selected) {
      const bots = (data.bots || []);
      return '<option value="">\\u9ed8\\u8ba4</option>' + bots.map((bot) => '<option value="' + escapeHtml(bot.id) + '"' + (bot.id === selected ? " selected" : "") + '>' + escapeHtml(bot.name || bot.id) + '</option>').join("");
    }
    function openClawAccountOptions(data, selected) {
      const accounts = data.wechat_accounts || [];
      const current = selected || "";
      const options = accounts.map((account) => {
        const id = String(account.id || account.account_id || "");
        const label = id + (account.user_id ? " / " + account.user_id : "");
        return '<option value="' + escapeHtml(id) + '"' + (id === current ? " selected" : "") + '>' + escapeHtml(label) + '</option>';
      }).join("");
      const missing = current && !accounts.some((account) => String(account.id || account.account_id || "") === current)
        ? '<option value="' + escapeHtml(current) + '" selected>' + escapeHtml(current + " (\\u672a\\u5728\\u5df2\\u4fdd\\u5b58\\u8d26\\u53f7\\u4e2d)") + '</option>'
        : "";
      return '<option value=""' + (!current ? " selected" : "") + '>\\u672a\\u9009\\u62e9</option>' + missing + options;
    }
    function renderQueues(data) {
      if (!$("queueMetrics")) return;
      $("queueMetrics").innerHTML = ["inbox", "outbox", "deferred", "failed", "sent", "processed", "pending_followups"].map((key) => metric(queueLabel(key), queueValue(data, key), key, key === "failed" && queueValue(data, key) ? "bad" : queueValue(data, key) ? "warn" : "")).join("");
      $("replyRecords").innerHTML = state.replies.length ? state.replies.map(renderRecord).join("") : '<div class="empty">\\u6682\\u65e0\\u8bb0\\u5f55\\u3002</div>';
    }
    function queueLabel(key) {
      return ({ inbox: "\\u5165\\u7ad9", outbox: "\\u5f85\\u53d1", deferred: "\\u5ef6\\u8fdf", failed: "\\u5931\\u8d25", sent: "\\u5df2\\u53d1\\u9001", processed: "\\u5df2\\u5904\\u7406", pending_followups: "\\u7b49\\u5f85\\u8ffd\\u95ee" })[key] || key;
    }
    function renderRecord(record) {
      const retry = record.queue === "failed" || record.queue === "deferred" ? '<button type="button" data-retry-queue="' + escapeHtml(record.queue) + '" data-retry-file="' + escapeHtml(record.file) + '">\\u91cd\\u8bd5</button>' : "";
      return '<div class="record"><span class="pill ' + (record.queue === "failed" ? "bad" : record.queue === "deferred" ? "warn" : "ok") + '">' + queueLabel(record.queue) + '</span><div><div class="item-title">' + escapeHtml(record.event_id || record.file) + '</div><div class="record-preview">' + escapeHtml(record.text_preview || record.error || "") + '</div><div class="item-meta">' + escapeHtml(record.updated_at ? new Date(record.updated_at).toLocaleString() : "") + '</div></div><div>' + retry + '</div></div>';
    }
    async function loadReplies() {
      const payload = await api("/api/replies?limit=80");
      state.replies = payload.replies || [];
      renderQueues(state.data || {});
    }
    function renderBots(data) {
      if (!$("botForm")) return;
      renderBotForm(data, null);
      renderBotList(data);
    }
    function renderBotForm(data, bot) {
      const b = bot || {};
      $("botForm").innerHTML =
        input("id", "ID", b.id || "") +
        input("name", "\\u540d\\u79f0", b.name || "") +
        select("wechat_transport", "\\u8def\\u5f84", '<option value="auto">Auto</option><option value="openclaw"' + (b.wechat_transport === "openclaw" ? " selected" : "") + '>OpenClaw</option><option value="uiauto"' + (b.wechat_transport === "uiauto" ? " selected" : "") + '>UIAuto</option>') +
        select("wechat_account_id", "OpenClaw Account", openClawAccountOptions(data, b.wechat_account_id || "")) +
        input("wechat_scope_id", "\\u8054\\u7cfb\\u4eba/Scope", b.wechat_scope_id || "") +
        input("target_character", "\\u89d2\\u8272", b.target_character || "") +
        input("conversation_id", "\\u4f1a\\u8bdd ID", b.conversation_id || "") +
        input("language", "\\u8bed\\u8a00", b.language || "zh-CN") +
        '<label><span>\\u72b6\\u6001</span><select name="enabled"><option value="true"' + (b.enabled !== false ? " selected" : "") + '>\\u542f\\u7528</option><option value="false"' + (b.enabled === false ? " selected" : "") + '>\\u505c\\u7528</option></select></label>' +
        '<div class="span row"><button class="primary" type="submit">\\u4fdd\\u5b58 Bot</button><button type="button" id="resetBotForm">\\u6e05\\u7a7a</button></div>';
    }
    function renderBotList(data) {
      const bots = data.bots || [];
      $("botList").innerHTML = bots.length ? bots.map((bot) => '<div class="item"><div class="item-head"><div><div class="item-title">' + escapeHtml(bot.name || bot.id) + '</div><div class="item-meta">' + escapeHtml(bot.id) + " / " + escapeHtml(bot.wechat_transport || "auto") + " / " + escapeHtml(bot.target_character || "\\u5f53\\u524d\\u89d2\\u8272") + '</div></div><div class="row"><button type="button" data-bot-edit="' + encodeURIComponent(bot.id) + '">\\u7f16\\u8f91</button><button type="button" class="danger" data-bot-delete="' + encodeURIComponent(bot.id) + '">\\u5220\\u9664</button></div></div></div>').join("") : '<div class="empty">\\u6682\\u65e0 Bot \\u7ed1\\u5b9a\\u3002</div>';
    }
    function renderConfig(data) {
      renderModelForm(data);
      renderParserForm(data);
    }
    function renderModelForm(data) {
      const m = data.model_api || {};
      const modelOptions = state.modelChoices.length ? state.modelChoices.map((item) => '<option value="' + escapeHtml(item.id) + '"' + (item.id === m.model ? " selected" : "") + '>' + escapeHtml(item.id) + '</option>').join("") : '<option value="' + escapeHtml(m.model || "") + '">' + escapeHtml(m.model || "\\u8bf7\\u5148\\u62c9\\u53d6\\u6a21\\u578b") + '</option>';
      $("modelForm").innerHTML =
        input("name", "\\u540d\\u79f0", m.name || "") +
        input("base_url", "Base URL", m.base_url || "") +
        input("api_key", "API Key", "") +
        select("model", "\\u6a21\\u578b\\u76ee\\u5f55", modelOptions) +
        input("temperature", "Temperature", m.temperature ?? "0.1", "number") +
        input("top_p", "Top P", m.top_p ?? "1", "number") +
        input("timeout_ms", "Timeout", m.timeout_ms || "60000", "number") +
        '<label><span>\\u542f\\u7528</span><select name="enabled"><option value="true"' + (m.enabled ? " selected" : "") + '>\\u542f\\u7528</option><option value="false"' + (!m.enabled ? " selected" : "") + '>\\u505c\\u7528</option></select></label>' +
        '<div class="span row"><button class="primary" type="submit">\\u4fdd\\u5b58\\u6a21\\u578b</button><button type="button" id="loadModels">\\u62c9\\u53d6\\u6a21\\u578b</button><span class="pill">' + (m.has_api_key ? "\\u5df2\\u4fdd\\u5b58 Key" : "\\u672a\\u4fdd\\u5b58 Key") + '</span></div>';
    }
    function renderParserForm(data) {
      const p = (data.agenda || {}).parser || {};
      $("parserForm").innerHTML =
        input("timezone", "\\u65f6\\u533a", p.timezone || "Asia/Shanghai") +
        input("entry_format", "\\u8f93\\u51fa\\u683c\\u5f0f", p.entry_format || "x\\u6708x\\u65e5\\uff0c\\u7528\\u6237/\\u89d2\\u8272\\u7ea6\\u5b9a\\u4e8b\\u9879\\uff1a...") +
        '<label class="span"><span>System Prompt</span><textarea name="system_prompt">' + escapeHtml(p.system_prompt || "") + '</textarea></label>' +
        '<label class="span"><span>User Prompt Template</span><textarea name="user_prompt_template">' + escapeHtml(p.user_prompt_template || "") + '</textarea></label>' +
        '<label><span>\\u542f\\u7528</span><select name="enabled"><option value="true"' + (p.enabled !== false ? " selected" : "") + '>\\u542f\\u7528</option><option value="false"' + (p.enabled === false ? " selected" : "") + '>\\u505c\\u7528</option></select></label>' +
        '<div class="span"><button class="primary" type="submit">\\u4fdd\\u5b58\\u63d0\\u793a\\u8bcd</button></div>';
    }
    function renderSnapshot(data) {
      if (!$("configSnapshot")) return;
      $("configSnapshot").textContent = JSON.stringify({
        config_path: data.config_path,
        connector_dir: data.connector_dir,
        current_transport: currentTransport(data),
        delivery: data.delivery,
        wechat: data.wechat,
        bots: data.bots,
        uiauto_accounts: data.uiauto_accounts,
        model_api: data.model_api,
        agenda: data.agenda,
        queues: data.queues
      }, null, 2);
    }
    function formObject(form) {
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      if (fd.has("days")) body.days = fd.getAll("days").map(Number);
      return body;
    }
    async function saveForm(path, form, mutate) {
      const body = formObject(form);
      if (mutate) mutate(body);
      await api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast("\\u5df2\\u4fdd\\u5b58");
      await refresh();
    }
    async function saveTaskForm(form) {
      await saveForm("/api/tasks", form, (body) => { body.enabled = true; });
      closeTaskModal();
    }
    async function toggleDeliveryMode() {
      const current = $("modeToggle").dataset.mode === "single" ? "single" : "split";
      await api("/api/delivery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message_mode: current === "split" ? "single" : "split" }) });
      await refresh();
    }
    async function saveMergeWindow() {
      const value = Number.parseInt($("mergeWindowMs").value || "0", 10);
      await api("/api/wechat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inbound_merge_window_ms: Number.isFinite(value) && value >= 0 ? value : 0 }) });
      await refresh();
    }
    function openTaskModal(data, task) {
      renderTaskForm(data, task || {});
      if ($("taskModal")) $("taskModal").hidden = false;
      document.body.classList.add("modal-open");
      const first = $("taskForm") ? $("taskForm").querySelector("input, select, textarea") : null;
      if (first) window.setTimeout(() => first.focus(), 30);
    }
    function closeTaskModal() {
      if ($("taskModal")) $("taskModal").hidden = true;
      document.body.classList.remove("modal-open");
    }
    function editTask(id) {
      const task = ((state.data || {}).tasks || []).find((item) => item.id === id);
      if (task) {
        state.scheduleTab = "trigger";
        if (task.date_key) state.triggerDate = task.date_key;
        renderSchedule(state.data || {});
        openTaskModal(state.data || {}, task);
      }
    }
    function editBot(id) {
      const bot = ((state.data || {}).bots || []).find((item) => item.id === id);
      if (bot) renderBotForm(state.data || {}, bot);
    }
    async function startOpenClawLogin() {
      const payload = await api("/api/openclaw-login/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      await pollOpenClaw(payload.id);
    }
    async function pollOpenClaw(id) {
      const box = $("qrBox");
      for (let i = 0; i < 240; i++) {
        const payload = await api("/api/openclaw-login/" + encodeURIComponent(id));
        if (payload.qrcode_image) box.innerHTML = '<img alt="OpenClaw QR" src="' + payload.qrcode_image + '"><p>' + escapeHtml(payload.status || "") + '</p>';
        else box.textContent = payload.status || "\\u7b49\\u5f85\\u4e8c\\u7ef4\\u7801";
        if (payload.done) { await refresh(); toast(payload.account ? "\\u626b\\u7801\\u5b8c\\u6210\\uff0c\\u5df2\\u66f4\\u65b0 OpenClaw \\u8d26\\u53f7" : (payload.error || "\\u626b\\u7801\\u7ed3\\u675f")); return; }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    async function checkUiauto() {
      const account = (state.data.uiauto_accounts || [])[0];
      if (!account) throw new Error("\\u5148\\u4fdd\\u5b58 UIAuto worker");
      const payload = await api("/api/uiauto-accounts/" + encodeURIComponent(account.id) + "/check", { method: "POST" });
      $("uiautoResult").textContent = payload.ok ? "\\u5065\\u5eb7" : "\\u5f02\\u5e38";
    }
    async function loadUiautoSessions() {
      const account = (state.data.uiauto_accounts || [])[0];
      if (!account) throw new Error("\\u5148\\u4fdd\\u5b58 UIAuto worker");
      const payload = await api("/api/uiauto-accounts/" + encodeURIComponent(account.id) + "/sessions");
      $("uiautoSessions").innerHTML = (payload.sessions || []).length ? payload.sessions.map((name) => '<button type="button" class="card-button" data-fill-contact="' + escapeHtml(name) + '">' + escapeHtml(name) + '</button>').join("") : '<div class="empty">\\u6ca1\\u6709\\u62c9\\u5230\\u4f1a\\u8bdd\\u3002</div>';
    }
    async function parseAgenda() {
      const form = $("agendaParseForm");
      const payload = await api("/api/agenda/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: new FormData(form).get("text"), save_entries: false }) });
      state.agendaPreview = payload.entries || [];
      $("agendaPreview").innerHTML = state.agendaPreview.length ? state.agendaPreview.map((entry, index) => '<div class="note ' + (entry.owner === "character" ? "role" : "user") + '"><div class="item-head"><div>' + escapeHtml(entry.date_text) + " / " + escapeHtml(entry.owner) + '<div class="item-meta">' + escapeHtml(entry.item) + '</div></div><button type="button" data-save-preview="' + index + '">\\u4fdd\\u5b58</button></div></div>').join("") : "\\u6ca1\\u6709\\u89e3\\u6790\\u5230\\u53ef\\u7528\\u4e8b\\u9879\\u3002";
    }
    function appendAgendaChat(role, text) {
      const log = $("agendaChatLog");
      if (!log) return;
      log.insertAdjacentHTML("beforeend", '<div class="chat-message ' + role + '">' + escapeHtml(text || "") + '</div>');
      log.scrollTop = log.scrollHeight;
    }
    function renderAgendaContextFiles() {
      const input = $("agendaContextFiles");
      const list = $("agendaContextFileList");
      if (!input || !list) return;
      const files = Array.from(input.files || []);
      list.innerHTML = files.length ? files.map((file) => '<span class="file-chip">' + escapeHtml(file.name) + ' · ' + Math.ceil(file.size / 1024) + 'KB</span>').join("") : '<span class="file-chip">\\u672a\\u9009\\u62e9\\u9644\\u4ef6</span>';
    }
    function isTextAttachment(file) {
      return /^text\\//i.test(file.type) || /\\.(txt|md|json|csv|log)$/i.test(file.name);
    }
    function readFileAs(file, mode) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("file read failed"));
        if (mode === "text") reader.readAsText(file);
        else reader.readAsDataURL(file);
      });
    }
    async function fileToAgendaAttachment(file) {
      if (file.size > 6 * 1024 * 1024) throw new Error(file.name + " \\u8d85\\u8fc7 6MB");
      const attachment = { name: file.name, type: file.type || "application/octet-stream", size: file.size };
      if (/^image\\//i.test(file.type)) attachment.data_url = await readFileAs(file, "data");
      else if (isTextAttachment(file)) attachment.text = await readFileAs(file, "text");
      return attachment;
    }
    async function sendAgendaContext(form) {
      const text = String(new FormData(form).get("text") || "").trim();
      const fileInput = $("agendaContextFiles");
      const files = Array.from((fileInput && fileInput.files) || []);
      if (!text && !files.length) throw new Error("\\u8bf7\\u8f93\\u5165\\u6587\\u5b57\\u6216\\u9009\\u62e9\\u9644\\u4ef6");
      appendAgendaChat("user", [text, files.length ? "\\u9644\\u4ef6: " + files.map((file) => file.name).join(", ") : ""].filter(Boolean).join("\\n"));
      const attachments = await Promise.all(files.map(fileToAgendaAttachment));
      appendAgendaChat("assistant", "\\u6b63\\u5728\\u53d1\\u7ed9 API \\u6574\\u7406...");
      const payload = await api("/api/agenda/context-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, attachments }) });
      const log = $("agendaChatLog");
      const last = log ? log.lastElementChild : null;
      if (last && last.textContent === "\\u6b63\\u5728\\u53d1\\u7ed9 API \\u6574\\u7406...") last.remove();
      appendAgendaChat("assistant", payload.reply || "\\u6ca1\\u6709\\u8fd4\\u56de\\u5185\\u5bb9");
      form.reset();
      renderAgendaContextFiles();
      try {
        const parsed = await api("/api/agenda/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: payload.reply || "", save_entries: false }) });
        state.agendaPreview = parsed.entries || [];
        $("agendaPreview").innerHTML = state.agendaPreview.length ? state.agendaPreview.map((entry, index) => '<div class="note ' + (entry.owner === "character" ? "role" : "user") + '"><div class="item-head"><div>' + escapeHtml(entry.date_text) + " / " + escapeHtml(entry.owner) + '<div class="item-meta">' + escapeHtml(entry.item) + '</div></div><button type="button" data-save-preview="' + index + '">\\u4fdd\\u5b58</button></div></div>').join("") : '<div class="empty">API \\u56de\\u590d\\u5df2\\u653e\\u5165\\u5bf9\\u8bdd\\uff0c\\u4f46\\u672a\\u89e3\\u6790\\u5230\\u53ef\\u4fdd\\u5b58\\u4e8b\\u9879\\u3002</div>';
      } catch (error) {
        $("agendaPreview").innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
      }
    }
    async function loadModels() {
      const form = $("modelForm");
      const body = formObject(form);
      const payload = await api("/api/model-api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      state.modelChoices = payload.models || [];
      renderModelForm(state.data || {});
      toast("\\u5df2\\u62c9\\u53d6 " + state.modelChoices.length + " \\u4e2a\\u6a21\\u578b");
    }

    document.addEventListener("click", async (event) => {
      if (event.target.id === "taskModal") { closeTaskModal(); return; }
      const target = event.target.closest("button");
      if (!target) return;
      try {
        if (target.dataset.pageButton) setPage(target.dataset.pageButton);
        if (target.dataset.scheduleTab) { state.scheduleTab = target.dataset.scheduleTab; renderSchedule(state.data || {}); }
        if (target.id === "refreshButton") { await refresh(); if (state.active === "queues") await loadReplies(); }
        if (target.id === "modeToggle") await toggleDeliveryMode();
        if (target.id === "saveMergeWindow") await saveMergeWindow();
        if (target.dataset.channel) { state.channelMode = target.dataset.channel; renderChannels(state.data || {}); await api("/api/channel-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: target.dataset.channel }) }); await refresh(); }
        if (target.id === "startOpenClawLogin") await startOpenClawLogin();
        if (target.dataset.openclawBind) { await api("/api/wechat-accounts/" + target.dataset.openclawBind + "/bind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bot_id: "default" }) }); await refresh(); toast("\\u5df2\\u7ed1\\u5b9a\\u5230\\u9ed8\\u8ba4 Bot"); }
        if (target.dataset.openclawDelete && confirm("\\u5220\\u9664\\u8fd9\\u4e2a OpenClaw \\u8d26\\u53f7\\uff1f\\u5df2\\u5f15\\u7528\\u7684 Bot \\u4f1a\\u81ea\\u52a8\\u6e05\\u7a7a\\u8d26\\u53f7\\u7ed1\\u5b9a\\u3002")) { await api("/api/wechat-accounts/" + target.dataset.openclawDelete, { method: "DELETE" }); await refresh(); }
        if (target.id === "checkUiautoWorker") await checkUiauto();
        if (target.id === "loadUiautoSessions") await loadUiautoSessions();
        if (target.dataset.taskSave) { event.preventDefault(); await saveTaskForm($("taskForm")); return; }
        if (target.id === "newTaskButton") { state.scheduleTab = "trigger"; renderSchedule(state.data || {}); openTaskModal(state.data || {}, { days: [todayWeekdayId(dateFromKey(state.triggerDate))] }); }
        if (target.id === "closeTaskModal") closeTaskModal();
        if (target.dataset.newDay) openTaskModal(state.data || {}, { days: [Number(target.dataset.newDay)] });
        if (target.id === "prevTriggerDay") { state.triggerDate = shiftDateKey(state.triggerDate, -1); renderTriggerTasks(state.data || {}); }
        if (target.id === "todayTriggerDay") { state.triggerDate = dateKey(new Date()); renderTriggerTasks(state.data || {}); }
        if (target.id === "nextTriggerDay") { state.triggerDate = shiftDateKey(state.triggerDate, 1); renderTriggerTasks(state.data || {}); }
        if (target.dataset.triggerDate) { state.triggerDate = target.dataset.triggerDate; renderTriggerTasks(state.data || {}); }
        if (target.dataset.taskEdit) editTask(decodeURIComponent(target.dataset.taskEdit));
        if (target.dataset.taskToggle) { await api("/api/tasks/" + target.dataset.taskToggle + "/toggle", { method: "POST" }); await refresh(); }
        if (target.dataset.taskDelete && confirm("\\u5220\\u9664\\u8fd9\\u4e2a\\u4efb\\u52a1\\uff1f")) { await api("/api/tasks/" + target.dataset.taskDelete, { method: "DELETE" }); await refresh(); }
        if (target.id === "prevMonth") { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCalendar(state.data || {}); }
        if (target.id === "thisMonth") { state.month = new Date(); state.selectedDate = dateKey(new Date()); renderCalendar(state.data || {}); }
        if (target.id === "nextMonth") { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(state.data || {}); }
        if (target.classList.contains("cal-day")) { state.selectedDate = target.dataset.date; renderCalendar(state.data || {}); }
        if (target.dataset.agendaDelete && confirm("\\u5220\\u9664\\u8fd9\\u6761\\u4fbf\\u7b7e\\uff1f")) { await api("/api/agenda/entries/" + target.dataset.agendaDelete, { method: "DELETE" }); await refresh(); }
        if (target.id === "parseAgendaButton") await parseAgenda();
        if (target.id === "clearAgendaContext") { if ($("agendaChatLog")) $("agendaChatLog").innerHTML = '<div class="chat-message assistant">\\u5bf9\\u8bdd\\u5df2\\u6e05\\u7a7a\\u3002</div>'; if ($("agendaPreview")) $("agendaPreview").innerHTML = '<div class="empty">\\u89e3\\u6790\\u7ed3\\u679c\\u4f1a\\u5728\\u8fd9\\u91cc\\u9884\\u89c8\\u3002</div>'; }
        if (target.id === "refreshRecords") await loadReplies();
        if (target.dataset.clear && confirm("\\u786e\\u5b9a\\u6e05\\u7406 " + queueLabel(target.dataset.clear) + "\\uff1f")) { await api("/api/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queue: target.dataset.clear }) }); await loadReplies(); await refresh(); }
        if (target.dataset.retryQueue) { await api("/api/replies/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queue: target.dataset.retryQueue, file: target.dataset.retryFile }) }); await loadReplies(); await refresh(); }
        if (target.dataset.botEdit) editBot(decodeURIComponent(target.dataset.botEdit));
        if (target.dataset.botDelete && confirm("\\u5220\\u9664\\u8fd9\\u4e2a Bot\\uff1f")) { await api("/api/bots/" + target.dataset.botDelete, { method: "DELETE" }); await refresh(); }
        if (target.id === "resetBotForm") renderBotForm(state.data || {}, {});
        if (target.id === "resetTaskForm") renderTaskForm(state.data || {}, {});
        if (target.id === "loadModels") await loadModels();
        if (target.dataset.savePreview) {
          const entry = state.agendaPreview[Number(target.dataset.savePreview)];
          if (entry) { await api("/api/agenda/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) }); await refresh(); }
        }
        if (target.dataset.fillContact) {
          const field = document.querySelector('#uiautoForm input[name="owner_contact_name"]');
          if (field) field.value = target.dataset.fillContact;
        }
      } catch (error) {
        toast(error.message);
      }
    });
    document.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        if (event.target.id === "uiautoForm") await saveForm("/api/uiauto-accounts", event.target, (body) => { body.enabled = body.enabled !== "false"; body.poll_interval_ms = Number(body.poll_interval_ms || 1500); });
        if (event.target.id === "taskForm") await saveTaskForm(event.target);
        if (event.target.id === "calendarDateTaskForm") await saveForm("/api/tasks", event.target, (body) => { body.enabled = true; body.intent = "\\u65e5\\u671f\\u7ea7\\u989d\\u5916\\u89e6\\u53d1\\uff0c\\u9700\\u7ed3\\u5408\\u5f53\\u5929\\u4e0a\\u4e0b\\u6587\\u67d4\\u5316\\u5904\\u7406"; });
        if (event.target.id === "agendaForm") await saveForm("/api/agenda/entries", event.target, (body) => { body.date_key = state.selectedDate; });
        if (event.target.id === "calendarAgendaForm") await saveForm("/api/agenda/entries", event.target, (body) => { body.date_key = state.selectedDate; });
        if (event.target.id === "agendaContextForm") await sendAgendaContext(event.target);
        if (event.target.id === "botForm") await saveForm("/api/bots", event.target, (body) => { body.enabled = body.enabled !== "false"; });
        if (event.target.id === "modelForm") await saveForm("/api/model-api", event.target, (body) => { body.enabled = body.enabled !== "false"; body.temperature = Number(body.temperature || 0.1); body.top_p = Number(body.top_p || 1); body.timeout_ms = Number(body.timeout_ms || 60000); });
        if (event.target.id === "parserForm") await saveForm("/api/agenda/parser", event.target, (body) => { body.enabled = body.enabled !== "false"; });
      } catch (error) {
        toast(error.message);
      }
    });
    document.addEventListener("change", (event) => {
      if (event.target.id === "agendaContextFiles") renderAgendaContextFiles();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && $("taskModal") && !$("taskModal").hidden) closeTaskModal();
    });
    renderNav({});
    renderScheduleTabs(state.scheduleTab);
    refresh().then(loadReplies).catch((error) => toast(error.message));
  </script>
</body>
</html>`;
}
