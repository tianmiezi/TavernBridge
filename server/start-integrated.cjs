const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const configDir = path.join(root, 'config');
const configPath = path.join(configDir, 'tavern-relay.config.json');
const exampleConfigPath = path.join(configDir, 'tavern-relay.config.example.json');
const defaultTavernUrl = 'http://127.0.0.1:8000/';

if (!fs.existsSync(configPath) && fs.existsSync(exampleConfigPath)) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.copyFileSync(exampleConfigPath, configPath);
  console.log(`[setup] Created ${configPath}`);
}

const children = [];
const auxiliaryChildren = [];

function spawnChild(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: {
      ...process.env,
      TAVERN_RELAY_CONFIG: configPath,
    },
    stdio: 'inherit',
    windowsHide: false,
    shell: Boolean(options.shell),
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[${name}] exited code=${code ?? ''} signal=${signal ?? ''}`);
    shutdown(code || 1);
  });
  return child;
}

function spawnAuxiliary(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    stdio: 'ignore',
    windowsHide: Boolean(options.windowsHide),
    shell: Boolean(options.shell),
    detached: Boolean(options.detached),
  });
  auxiliaryChildren.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[${name}] exited code=${code ?? ''} signal=${signal ?? ''}`);
  });
  child.unref();
  return child;
}

function keepaliveUrl() {
  const raw = process.env.CTB_TAVERN_URL || defaultTavernUrl;
  const url = new URL(raw);
  url.searchParams.set('ctb_keepalive', '1');
  url.searchParams.set('ctb_auto_connect', '1');
  url.searchParams.set('ctb_bot_id', process.env.CTB_KEEPALIVE_BOT_ID || 'default');
  return url.toString();
}

function findBrowserExecutable() {
  const candidates = [
    process.env.CTB_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

async function waitForTavern(url, timeoutMs = 30 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return true;
      }
    } catch {
      // SillyTavern may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

async function startTavernKeepalive() {
  if (process.env.CTB_TAVERN_KEEPALIVE !== '1') {
    console.log('[keepalive] using in-page Tavern keepalive only; no dedicated browser window will be opened.');
    return;
  }
  console.log('[keepalive] CTB_TAVERN_KEEPALIVE=1 is deprecated. Open SillyTavern normally and keep Codex Tavern Bridge connected in the extension panel.');
}

let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  for (const child of auxiliaryChildren) {
    if (!child.killed) {
      child.kill();
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  console.log('CodexTavernBridge integrated server');
  console.log(`Bridge SSE: http://127.0.0.1:${process.env.CTB_PORT || '8787'}`);
  console.log(`Admin UI:   http://127.0.0.1:${process.env.WEIXIN_RELAY_ADMIN_PORT || '8790'}`);

  spawnChild('bridge', process.execPath, [path.join(root, 'bridge-server.cjs')]);
  spawnChild('relay', process.execPath, [
    path.join(root, 'node_modules', 'tsx', 'dist', 'cli.cjs'),
    path.join(root, 'src', 'cli.ts'),
    'weixin',
    'serve',
    '--cwd',
    root,
  ]);

  void startTavernKeepalive().catch((error) => {
    console.log(`[keepalive] failed: ${error.message || error}`);
  });
}

void main().catch((error) => {
  console.log(`[startup] failed: ${error.message || error}`);
  shutdown(1);
});
