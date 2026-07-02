# Archived WeChat Routes

These routes are intentionally not part of the active runtime.

## Android Emulator / ADB

Archived because emulator testing triggered account risk control. The route also depended on emulator resolution, Android UI text, and fragile screen state.

## Docker Linux WeChat

Archived because the desktop container could run, but real WeChat scan login failed with `unable to log in`. The failure point looked like environment/login risk judgment rather than a normal bridge bug.

## Host Desktop Fallback

Archived because mouse, keyboard, clipboard, and foreground-window automation can interfere with the user's real desktop. The active UIAuto route must run inside a VM worker instead.

## Current Decision

The project keeps only two active paths:

- OpenClaw for official bot/API style routing.
- UIAuto/VM for a real alt account isolated inside a Windows VM.
