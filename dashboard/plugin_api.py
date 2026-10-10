"""9router quota backend, mounted at /api/plugins/hermes-ninerouter-quota/.

Logs into the 9router dashboard with NINEROUTER_DASHBOARD_PASSWORD (read from
env or $HERMES_HOME/.env), caches the session cookie, re-logs only on 401.
Secrets are never returned.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
from pathlib import Path

from fastapi import APIRouter, Body

router = APIRouter()
_lock = threading.Lock()
_cache: dict = {"at": 0.0, "data": None}
_opener = None
CACHE_TTL = 45


def _env() -> dict:
    out = {}
    home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    try:
        for line in (home / ".env").read_text().splitlines():
            m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                v = m[2]
                if len(v) > 1 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                out[m[1]] = v
    except OSError:
        pass
    for k in ("NINEROUTER_DASHBOARD_PASSWORD", "NINEROUTER_URL"):
        if os.environ.get(k):
            out[k] = os.environ[k]
    return out


class _Err(Exception):
    pass


def _base(env):
    url = env.get("NINEROUTER_URL")
    if not url:
        raise _Err("NINEROUTER_URL missing in ~/.hermes/.env")
    return url.rstrip("/")


def _login(env):
    global _opener
    pw = env.get("NINEROUTER_DASHBOARD_PASSWORD")
    if not pw:
        raise _Err("NINEROUTER_DASHBOARD_PASSWORD missing in ~/.hermes/.env")
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    req = urllib.request.Request(
        _base(env) + "/api/auth/login",
        data=json.dumps({"password": pw}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        op.open(req, timeout=15).read()
    except urllib.error.HTTPError as e:
        raise _Err(f"login failed: HTTP {e.code}")
    except Exception as e:  # noqa: BLE001
        raise _Err(f"login failed: {e}")
    _opener = op


def _get(env, path, retry=True):
    if _opener is None:
        _login(env)
    try:
        return json.load(_opener.open(_base(env) + path, timeout=25))
    except urllib.error.HTTPError as e:
        if e.code == 401 and retry:
            _login(env)
            return _get(env, path, retry=False)
        raise _Err(f"HTTP {e.code} on {path}")
    except Exception as e:  # noqa: BLE001
        raise _Err(f"{path}: {e}")


def _put(env, path, payload, retry=True):
    if _opener is None:
        _login(env)
    req = urllib.request.Request(
        _base(env) + path, data=json.dumps(payload).encode(), method="PUT",
        headers={"Content-Type": "application/json"},
    )
    try:
        return json.load(_opener.open(req, timeout=25))
    except urllib.error.HTTPError as e:
        if e.code == 401 and retry:
            _login(env)
            return _put(env, path, payload, retry=False)
        raise _Err(f"HTTP {e.code} on {path}")
    except Exception as e:  # noqa: BLE001
        raise _Err(f"{path}: {e}")


def _one(env, c):
    label = c.get("name") or c.get("email") or c["provider"]
    item = {
        "id": c["id"], "provider": c["provider"], "label": label,
        "active": bool(c.get("isActive", True)), "plan": None,
        "quotas": [], "extra": None, "resets": None, "error": None,
    }
    try:
        u = _get(env, "/api/usage/" + c["id"])
    except _Err as e:
        item["error"] = str(e)
        return item
    if not isinstance(u, dict):
        return item
    if u.get("error"):
        item["error"] = str(u["error"])[:160]
    item["plan"] = u.get("plan")
    for name, q in (u.get("quotas") or {}).items():
        if not isinstance(q, dict):
            continue
        total = q.get("total")
        used = q.get("used")
        rem = q.get("remainingPercentage")
        if rem is None and total:
            rem = max(0.0, 100.0 * (total - (used or 0)) / total)
        item["quotas"].append({
            "name": name, "used": used, "total": total,
            "remainingPct": rem, "resetAt": q.get("resetAt"),
            "unlimited": bool(q.get("unlimited")),
        })
    rc = u.get("resetCredits")
    if isinstance(rc, dict):
        item["resets"] = {
            "available": rc.get("availableCount") or 0,
            "expiresAt": rc.get("expiresAt"),
            "cooldownUntil": rc.get("cooldownUntil"),
        }
    ex = u.get("extraUsage")
    if isinstance(ex, dict) and ex.get("is_enabled"):
        item["extra"] = {
            "used": ex.get("used_credits"), "limit": ex.get("monthly_limit"),
            "pct": ex.get("utilization"), "currency": ex.get("currency"),
        }
    return item


def _fetch():
    env = _env()
    conns = _get(env, "/api/providers").get("connections", [])
    conns = [c for c in conns if c.get("authType") != "apikey"]
    with ThreadPoolExecutor(max_workers=6) as ex:
        items = list(ex.map(lambda c: _one(env, c), conns))
    return {"ok": True, "fetchedAt": time.time(), "items": items}


@router.get("/quotas")
def quotas(force: int = 0):
    with _lock:
        if not force and _cache["data"] and time.time() - _cache["at"] < CACHE_TTL:
            return _cache["data"]
        try:
            data = _fetch()
        except _Err as e:
            return {"ok": False, "error": str(e), "items": []}
        _cache.update(at=time.time(), data=data)
        return data


_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@router.post("/toggle")
def toggle(payload: dict = Body(...)):
    cid = str(payload.get("id", ""))
    if not _ID_RE.match(cid) or not isinstance(payload.get("active"), bool):
        return {"ok": False, "error": "bad request"}
    with _lock:
        try:
            _put(_env(), "/api/providers/" + cid, {"isActive": payload["active"]})
        except _Err as e:
            return {"ok": False, "error": str(e)}
        _cache.update(at=0.0, data=None)
    return {"ok": True}
