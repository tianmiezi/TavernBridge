const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const configDir = path.join(root, 'config');
const configPath = path.join(configDir, 'tavern-relay.config.json');
const exampleConfigPath = path.join(configDir, 'tavern-relay.config.example.json');

if (!fs.existsSync(configPath) && fs.existsSync(exampleConfigPath)) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.copyFileSync(exampleConfigPath, configPath);
  console.log(`[setup] Created ${configPath}`);
}

const children = [];

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

let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

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
