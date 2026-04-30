import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { WeixinAccountStore } from './platforms/weixin/account_store.js';
import { WEIXIN_DEFAULT_BASE_URL, defaultCodexBridgeStateDir } from './platforms/weixin/config.js';
import { clearContextTokensForAccount } from './platforms/weixin/official/context_tokens.js';
import { DEFAULT_ILINK_BOT_TYPE, officialQrLogin } from './platforms/weixin/official/login.js';
import { runRelayService } from './relay/service.js';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode') as {
  toFile(filePath: string, text: string, options?: Record<string, unknown>): Promise<void>;
};

interface CliOptions {
  stateDir: string;
  cwd?: string | null;
  botType?: string;
  timeoutSeconds?: number;
  accountId?: string | null;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const [group, command, ...rest] = argv;
  if (group !== 'weixin') {
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (command === 'login') {
    await runLogin(parseOptions(rest));
    return;
  }
  if (command === 'clear-context') {
    await runClearContext(parseOptions(rest));
    return;
  }
  if (command === 'serve') {
    const options = parseOptions(rest);
    if (options.cwd) {
      process.chdir(path.resolve(options.cwd));
    }
    await runRelayService({ stateDir: options.stateDir, cwd: options.cwd });
    return;
  }
  printUsage();
  process.exitCode = 1;
}

async function runLogin(options: CliOptions): Promise<void> {
  const accountStore = accountStoreFor(options.stateDir);
  const credentials = await officialQrLogin({
    accountStore,
    accountsDir: accountStore.rootDir,
    botType: options.botType ?? DEFAULT_ILINK_BOT_TYPE,
    timeoutSeconds: options.timeoutSeconds ?? 480,
    onQrCode: async ({ qrcode, qrcodeImageContent }) => {
      const artifact = await materializeQrArtifact(options.stateDir, qrcode, qrcodeImageContent);
      process.stdout.write(`Scan this QR with WeChat:\n${artifact}\n`);
    },
    onStatus: ({ status }) => {
      process.stdout.write(`login_status=${status}\n`);
    },
  });

  if (!credentials) {
    throw new Error('WeChat login did not return credentials.');
  }
  process.stdout.write(`logged_in_account=${credentials.account_id}\n`);
  process.stdout.write(`base_url=${credentials.base_url || WEIXIN_DEFAULT_BASE_URL}\n`);
}

async function runClearContext(options: CliOptions): Promise<void> {
  const accountStore = accountStoreFor(options.stateDir);
  const accountId = options.accountId || accountStore.listAccounts()[0] || null;
  if (!accountId) {
    throw new Error('No saved WeChat account was found.');
  }
  clearContextTokensForAccount(accountStore.rootDir, accountId);
  process.stdout.write(`cleared_context_tokens_for=${accountId}\n`);
}

function accountStoreFor(stateDir: string): WeixinAccountStore {
  return new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    stateDir: path.resolve(process.env.CODEXBRIDGE_STATE_DIR ?? defaultCodexBridgeStateDir()),
    cwd: null,
    accountId: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--state-dir' && next) {
      options.stateDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--cwd' && next) {
      options.cwd = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--bot-type' && next) {
      options.botType = next;
      index += 1;
      continue;
    }
    if (arg === '--timeout-seconds' && next) {
      options.timeoutSeconds = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (arg === '--account-id' && next) {
      options.accountId = next;
      index += 1;
    }
  }
  return options;
}

async function materializeQrArtifact(stateDir: string, qrcode: string, qrcodeImageContent: string): Promise<string> {
  const outputDir = path.join(stateDir, 'weixin', 'login');
  await fs.mkdir(outputDir, { recursive: true });
  const content = String(qrcodeImageContent || '').trim();
  if (content) {
    const match = /^data:([^;]+);base64,(.+)$/u.exec(qrcodeImageContent);
    if (match) {
      const ext = match[1]?.includes('svg') ? 'svg' : 'png';
      const outputPath = path.join(outputDir, `weixin-qr.${ext}`);
      await fs.writeFile(outputPath, Buffer.from(match[2] ?? '', 'base64'));
      return outputPath;
    }
    if (/^<svg[\s>]/iu.test(content)) {
      const outputPath = path.join(outputDir, 'weixin-qr.svg');
      await fs.writeFile(outputPath, content, 'utf8');
      return outputPath;
    }
    const outputPath = path.join(outputDir, 'weixin-qr.png');
    await QRCode.toFile(outputPath, content, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
    });
    await fs.writeFile(path.join(outputDir, 'weixin-qr-content.txt'), `${content}\n`, 'utf8');
    return outputPath;
  }
  const outputPath = path.join(outputDir, 'weixin-qr.txt');
  await fs.writeFile(outputPath, `${qrcode}\n`, 'utf8');
  return outputPath;
}

function printUsage(): void {
  process.stderr.write([
    'Usage:',
    '  tsx src/cli.ts weixin login [--state-dir <dir>]',
    '  tsx src/cli.ts weixin serve [--state-dir <dir>] [--cwd <dir>]',
    '  tsx src/cli.ts weixin clear-context [--state-dir <dir>] [--account-id <id>]',
    '',
  ].join('\n'));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
