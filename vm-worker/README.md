# UIAuto/VM Worker

This folder is the VM-side runner for the real WeChat alt-account path.

Run these commands inside the Windows VM, not on the host machine.

## 1. Prepare The VM

Install the official Windows WeChat client in the VM and log in with the alt account.

Install Python 3.10+ in the VM. Python 3.9 can work with matching wheels, but Python 3.10+ is easier for wxautox dependencies.

## 2. Create The Isolated Python Environment

```powershell
cd CodexTavernBridge
.\vm-worker\setup-uiauto-worker.bat
```

If PyPI is blocked, use a local wheel folder:

```powershell
.\vm-worker\setup-uiauto-worker.bat -WheelDir C:\Downloads\wxauto-wheels
```

If the local wheel folder does not include dependencies such as `pillow`, `psutil`, or `requests`, and your base Python already has them installed, recreate the environment with:

```powershell
.\vm-worker\setup-uiauto-worker.bat -WheelDir C:\Downloads\wxauto-wheels -UseSystemSitePackages
```

If the host needs to reach this worker across the VM network, either allow TCP `8795` manually in Windows Firewall or run:

```powershell
.\vm-worker\setup-uiauto-worker.bat -OpenFirewall
```

The setup script creates `.venv-uiauto-worker` at the project root. This folder is ignored by git.

## 3. Start The Worker

```powershell
.\vm-worker\start-uiauto-worker.bat
```

The worker listens on `0.0.0.0:8795` by default and prints URL candidates such as:

```text
http://192.168.x.x:8795
```

Use that URL on the host control panel: **Channels -> UIAuto/VM -> Worker address**.

## 4. Check Connectivity

Inside the VM:

```powershell
.\vm-worker\check-uiauto-worker.bat -Deep
```

From the host, replace the IP with the VM IP:

```powershell
.\vm-worker\check-uiauto-worker.bat -Url http://192.168.x.x:8795 -Deep
```

To register the target contact listener:

```powershell
.\vm-worker\check-uiauto-worker.bat -Url http://192.168.x.x:8795 -Deep -Contact "My Main Account"
```

## Boundary

The host bridge never starts local WeChat automation. The VM worker exposes only:

- `GET /health`
- `GET /health?deep=1`
- `GET /sessions`
- `POST /poll`
- `POST /send-text`

No desktop-input fallback, no mouse control, no keyboard simulation, no Android ADB, and no Docker Linux WeChat path are part of this worker.
