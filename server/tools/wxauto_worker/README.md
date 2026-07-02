# UIAuto VM Worker

This worker is the small VM-side HTTP adapter for the UIAuto/VM channel.

It is not started by the host bridge. Run it only inside the Windows VM that has the official WeChat client logged in with the real alt account.

## Start In VM

Create the isolated Python environment:

```powershell
cd CodexTavernBridge
.\vm-worker\setup-uiauto-worker.bat
```

If PyPI is unavailable, pass a local wheel directory:

```powershell
.\vm-worker\setup-uiauto-worker.bat -WheelDir C:\Downloads\wxauto-wheels
```

Then start the worker:

```powershell
cd CodexTavernBridge
.\vm-worker\start-uiauto-worker.bat
```

Check it from the VM or host:

```powershell
.\vm-worker\check-uiauto-worker.bat -Url http://127.0.0.1:8795 -Deep
```

Register/check a target contact listener:

```powershell
.\vm-worker\check-uiauto-worker.bat -Url http://127.0.0.1:8795 -Deep -Contact "My Main Account"
```

## API

- `GET /health`
- `GET /health?deep=1`
- `GET /sessions`
- `POST /poll`
- `POST /send-text`

The active inbound path is listener queue polling. The worker does not contain host desktop fallback, mouse control, keyboard simulation, screenshot parsing, Android ADB, or Docker Linux WeChat logic.
