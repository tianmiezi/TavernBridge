# Codex Tavern Bridge

Codex Tavern Bridge is a local SillyTavern extension and backend bridge for routing chat events between SillyTavern and WeChat-facing channels.

The active project now has two supported channel paths:

- **OpenClaw**: official bot/API style entry, with QR login integrated in the admin console.
- **UIAuto/VM**: a real WeChat alt account controlled inside a separate Windows VM through a small HTTP worker.

Android emulator, ADB, Docker Linux WeChat, native desktop fallback, and host-machine wxauto autostart experiments are archived and are not part of the active runtime path.

## Start

Install the server dependencies once:

```powershell
cd CodexTavernBridge/server
npm install
```

Start the local bridge:

```powershell
cd CodexTavernBridge
.\start-bridge.bat
```

Local endpoints:

```text
http://127.0.0.1:8787  SillyTavern extension bridge
http://127.0.0.1:8790  Admin console
```

## SillyTavern Setup

1. Enable the Codex Tavern Bridge extension.
2. Set the bridge URL to `http://127.0.0.1:8787`.
3. Set `Bot ID` to the binding you want, usually `default`.
4. Keep the SillyTavern chat open when you want generated replies to be produced from frontend context.

## Channels

### OpenClaw

Use the admin console at `http://127.0.0.1:8790`, open **Channels**, select **OpenClaw**, and start QR login.

OpenClaw credentials are bot credentials. They are not real personal WeChat alt accounts.

### UIAuto/VM

UIAuto/VM is for a real WeChat alt account. The host project only stores a remote worker URL and never starts local WeChat automation.

Recommended layout:

```text
Host Windows:
  SillyTavern
  Codex Tavern Bridge

Windows VM:
  Official WeChat logged in as the alt account
  UIAuto worker listening on http://VM-IP:8795
```

Inside the VM, create the isolated Python environment:

```powershell
cd CodexTavernBridge
.\vm-worker\setup-uiauto-worker.bat
```

If PyPI is blocked, pass a local wheel directory:

```powershell
.\vm-worker\setup-uiauto-worker.bat -WheelDir C:\Downloads\wxauto-wheels
```

If that wheel folder is incomplete but the base Python already has dependencies installed:

```powershell
.\vm-worker\setup-uiauto-worker.bat -WheelDir C:\Downloads\wxauto-wheels -UseSystemSitePackages
```

Then start the worker inside the VM:

```powershell
.\vm-worker\start-uiauto-worker.bat
```

The start script prints URL candidates such as `http://192.168.x.x:8795`. Configure **Channels -> UIAuto/VM** on the host:

- Worker address: `http://VM-IP:8795`
- Target contact: the main account remark/display name, for example `My Main Account`
- Bot ID: the SillyTavern route to use

Connectivity check:

```powershell
.\vm-worker\check-uiauto-worker.bat -Url http://VM-IP:8795 -Deep
```

## Message Format

Generated replies can be split by `<message>` tags:

```text
<message>第一条微信消息</message>
<message>第二条微信消息</message>
```

The admin console can also switch delivery mode between split and single-message delivery.

## Core Modules

- **Overview**: current path, queue risk, today's enabled tasks.
- **Schedule**: fixed and random weekly triggers.
- **Queues**: pending, deferred, failed, and sent reply records.
- **Channels**: OpenClaw and UIAuto/VM configuration.
- **Config**: custom model API, agenda parser prompts, and config snapshot.

## Development

Run type checking:

```powershell
cd CodexTavernBridge/server
npm run typecheck
```

Local data and logs should not be committed:

```text
server/node_modules/
.venv-uiauto-worker/
server/config/tavern-relay.config.json
server/data/
server/wxauto_logs/
wxauto_logs/
*.log
```
