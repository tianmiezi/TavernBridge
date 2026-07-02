from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

VERSION = "0.3.0-vm-minimal"
MAX_QUEUE = 200
DEFAULT_SEND_TIMEOUT_SECONDS = 8

_wx_lock = threading.RLock()
_wx: Any | None = None
_backend_error = ""
_listen_registered: set[str] = set()
_queues: dict[str, list[dict[str, Any]]] = {}
_last_error = ""
_last_contact = ""
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8-sig")
    return json.loads(raw) if raw.strip() else {}


def import_backend() -> tuple[Any | None, str, str]:
    forced = os.environ.get("WXAUTO_BACKEND", "").strip()
    candidates = [forced] if forced else ["wxautox", "wxautox4", "wxauto4", "wxauto"]
    errors: list[str] = []
    for name in candidates:
        if not name:
            continue
        try:
            module = __import__(name)
            return module, name, ""
        except Exception as exc:  # pragma: no cover, environment-dependent
            errors.append(f"{name}: {exc}")
    return None, "", "; ".join(errors)


def get_wx() -> Any:
    global _wx, _backend_error
    with _wx_lock:
        if _wx is not None:
            return _wx
        module, name, error = import_backend()
        if not module:
            _backend_error = error or "No wxauto-compatible package is importable."
            raise RuntimeError(_backend_error)
        cls = getattr(module, "WeChat", None)
        if cls is None:
            _backend_error = f"{name} does not expose WeChat."
            raise RuntimeError(_backend_error)
        try:
            _wx = cls(ads=False)
        except TypeError:
            _wx = cls()
        _backend_error = ""
        return _wx


def backend_name() -> str:
    module, name, _error = import_backend()
    return name if module else ""


def message_signature(contact: str, message: dict[str, Any]) -> str:
    text = str(message.get("text") or "")
    sender = str(message.get("sender") or "")
    msg_type = str(message.get("type") or "text")
    when = str(message.get("time") or message.get("received_at") or "")
    return hashlib.sha256(f"{contact}:{sender}:{msg_type}:{when}:{text}".encode("utf-8")).hexdigest()


def normalize_message(contact: str, raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        text = str(raw.get("text") or raw.get("content") or raw.get("message") or "").strip()
        sender = str(raw.get("sender") or raw.get("from") or raw.get("who") or "").strip()
        msg_type = str(raw.get("type") or "text").strip() or "text"
        when = str(raw.get("time") or raw.get("created_at") or "").strip()
    else:
        text = str(raw or "").strip()
        sender = ""
        msg_type = "text"
        when = ""
    if not text:
        return None
    item = {
        "text": text,
        "sender": sender,
        "type": msg_type,
        "time": when,
        "received_at": now_iso(),
    }
    signature = message_signature(contact, item)
    item["signature"] = signature
    item["message_id"] = f"uiauto_{signature[:16]}"
    return item


def enqueue(contact: str, raw: Any) -> None:
    message = normalize_message(contact, raw)
    if not message:
        return
    queue = _queues.setdefault(contact, [])
    if not any(item.get("signature") == message["signature"] for item in queue):
        queue.append(message)
        del queue[:-MAX_QUEUE]


def ensure_listener(contact: str) -> None:
    global _last_error, _last_contact
    if not contact:
        raise RuntimeError("owner_contact_name is required.")
    if os.environ.get("WXAUTO_FAKE_LISTENER") == "1":
        _listen_registered.add(contact)
        return
    if contact in _listen_registered:
        return
    wx = get_wx()
    add_listen = getattr(wx, "AddListenChat", None)
    start_listening = getattr(wx, "StartListening", None)
    if not callable(add_listen) or not callable(start_listening):
        raise RuntimeError("wxautox listener APIs are unavailable: AddListenChat/StartListening not found.")

    def callback(*args: Any, **kwargs: Any) -> None:
        try:
            payload: Any = kwargs or (args[-1] if args else "")
            if isinstance(payload, list):
                for item in payload:
                    enqueue(contact, item)
            else:
                enqueue(contact, payload)
        except Exception as exc:  # pragma: no cover, callback safety
            sys.stderr.write(f"[uiauto-worker] listener callback failed: {exc}\n")

    try:
        add_listen(contact, callback=callback)
    except TypeError:
        add_listen(contact, callback)
    start_listening()
    _listen_registered.add(contact)
    _last_contact = contact
    _last_error = ""


def drain(contact: str, recent_signatures: list[str]) -> list[dict[str, Any]]:
    recent = set(str(item) for item in recent_signatures if item)
    queue = _queues.setdefault(contact, [])
    messages = [item for item in queue if item.get("signature") not in recent]
    _queues[contact] = []
    return messages[-20:]


def public_sessions() -> list[str]:
    try:
        wx = get_wx()
        getter = getattr(wx, "GetSession", None)
        if not callable(getter):
            return []
        sessions = getter()
        if isinstance(sessions, dict):
            return [str(key) for key in sessions.keys()]
        if isinstance(sessions, list):
            result = []
            for item in sessions:
                if isinstance(item, dict):
                    result.append(str(item.get("name") or item.get("who") or item.get("title") or ""))
                else:
                    result.append(str(item))
            return [item for item in result if item.strip()]
        return []
    except Exception:
        return []


def send_text(contact: str, text: str) -> dict[str, Any]:
    if not contact:
        raise RuntimeError("owner_contact_name is required.")
    normalized = str(text or "").strip()
    if not normalized:
        raise RuntimeError("text is required.")
    wx = get_wx()
    send = getattr(wx, "SendMsg", None)
    if not callable(send):
        raise RuntimeError("wxautox/wxauto SendMsg is not available.")

    def run_send() -> Any:
        try:
            return send(normalized, who=contact, clear=True)
        except TypeError:
            return send(normalized, contact)

    timeout = float(os.environ.get("WXAUTO_SEND_TIMEOUT_SECONDS") or DEFAULT_SEND_TIMEOUT_SECONDS)
    future = _executor.submit(run_send)
    return {"ok": True, "result": future.result(timeout=timeout)}


class WorkerHandler(BaseHTTPRequestHandler):
    server_version = "CodexTavernBridgeUiautoWorker/0.3"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[uiauto-worker] " + (fmt % args) + "\n")

    def do_GET(self) -> None:  # noqa: N802
        global _last_error
        try:
            if self.path.startswith("/health"):
                deep = "deep=1" in self.path
                payload = {
                    "ok": True,
                    "version": VERSION,
                    "backend": backend_name(),
                    "state": "ready",
                    "last_error": _last_error,
                    "last_contact": _last_contact,
                    "listener_registered": sorted(_listen_registered),
                    "queue_size": sum(len(items) for items in _queues.values()),
                }
                if deep:
                    get_wx()
                json_response(self, 200, payload)
                return
            if self.path.startswith("/sessions"):
                json_response(self, 200, {"ok": True, "sessions": public_sessions()})
                return
            json_response(self, 404, {"ok": False, "error": "not found"})
        except Exception as exc:
            _last_error = str(exc)
            json_response(self, 503, {"ok": False, "version": VERSION, "backend": backend_name(), "state": "unavailable", "error": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        global _last_error, _last_contact
        try:
            body = read_json(self)
            if self.path == "/poll":
                contact = str(body.get("owner_contact_name") or "").strip()
                ensure_listener(contact)
                messages = drain(contact, [str(item) for item in body.get("recent_signatures") or []])
                _last_contact = contact
                json_response(self, 200, {"ok": True, "state": "listener-poll", "messages": messages, "scanned_at": now_iso()})
                return
            if self.path == "/send-text":
                contact = str(body.get("owner_contact_name") or "").strip()
                text = str(body.get("text") or "")
                result = send_text(contact, text)
                _last_contact = contact
                _last_error = ""
                json_response(self, 200, result)
                return
            if self.path == "/fake/enqueue" and os.environ.get("WXAUTO_FAKE_LISTENER") == "1":
                contact = str(body.get("owner_contact_name") or "").strip()
                for item in body.get("messages") or []:
                    enqueue(contact, item)
                json_response(self, 200, {"ok": True, "queue_size": len(_queues.get(contact, []))})
                return
            json_response(self, 404, {"ok": False, "error": "not found"})
        except concurrent.futures.TimeoutError:
            _last_error = "SendMsg timed out."
            json_response(self, 504, {"ok": False, "error": _last_error})
        except Exception as exc:
            _last_error = str(exc)
            json_response(self, 500, {"ok": False, "error": str(exc)})


def main() -> None:
    parser = argparse.ArgumentParser(description="CodexTavernBridge UIAuto VM worker")
    parser.add_argument("--host", default=os.environ.get("WXAUTO_WORKER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("WXAUTO_WORKER_PORT", "8795")))
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), WorkerHandler)
    print(f"[uiauto-worker] listening http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
