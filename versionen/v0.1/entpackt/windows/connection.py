"""Store API settings in Windows DPAPI and proxy calls to the configured HTTPS API."""

import ctypes as c
from ctypes import wintypes as w
from datetime import datetime
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4

BASE_URL = ""
HEADER = re.compile(r"[A-Za-z0-9-]{1,60}\Z")
SECRET_FIELDS = {"readToken", "writeToken"}
MAX_BYTES = 12_000_000


class Blob(c.Structure):
    _fields_ = [("size", w.DWORD), ("data", c.POINTER(c.c_ubyte))]


def protect(data, *, decode=False):
    crypt = c.WinDLL("Crypt32", use_last_error=True)
    release = c.WinDLL("Kernel32").LocalFree
    release.argtypes = [w.HLOCAL]
    release.restype = w.HLOCAL
    buffer = (c.c_ubyte * len(data)).from_buffer_copy(data)
    source = Blob(len(data), c.cast(buffer, c.POINTER(c.c_ubyte)))
    result = Blob()
    fn = crypt.CryptUnprotectData if decode else crypt.CryptProtectData
    fn.argtypes = [c.POINTER(Blob), c.c_void_p, c.c_void_p, c.c_void_p, c.c_void_p, w.DWORD, c.POINTER(Blob)]
    fn.restype = w.BOOL
    if not fn(c.byref(source), None, None, None, None, 1, c.byref(result)):
        raise OSError("Die Einstellungen konnten in Windows nicht ver- oder entschlüsselt werden.")
    try:
        return c.string_at(result.data, result.size)
    finally:
        release(c.cast(result.data, c.c_void_p))


def normalize_base(value):
    if not isinstance(value, str):
        raise ValueError("Die API-Adresse fehlt.")
    parsed = urlsplit(value.strip())
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
        or parsed.query or parsed.fragment or any(ord(ch) < 33 for ch in parsed.netloc + parsed.path)
        or "\\" in parsed.netloc + parsed.path or "%" in parsed.path
        or any(part in (".", "..") for part in parsed.path.split("/"))):
        raise ValueError("Die API-Adresse muss eine HTTPS-URL ohne Zugangsdaten, Abfrage oder Fragment sein.")
    if parsed.port is not None and not 0 < parsed.port < 65536:
        raise ValueError("Ungültiger API-Port.")
    return urlunsplit(("https", parsed.netloc.lower(), parsed.path.rstrip("/"), "", ""))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class ApiStatus(ValueError):
    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


class Connection:
    def __init__(self, profile_path):
        self.path = profile_path
        self.opener = build_opener(NoRedirect())

    def load(self):
        try:
            return json.loads(protect(self.path.read_bytes(), decode=True))
        except FileNotFoundError:
            return {"baseUrl": BASE_URL, "protocol": "gymprogress", "preset": True}

    def credentials(self, profile):
        writer = profile.get("writeToken")
        reader = profile.get("readToken") or writer
        return reader, writer

    def public(self):
        profile = self.load()
        reader, writer = self.credentials(profile)
        return {**{key: value for key, value in profile.items() if key not in SECRET_FIELDS},
                "canRead": bool(reader) or profile["protocol"] == "json", "canWrite": bool(writer)
                or (profile["protocol"] == "json" and profile.get("authHeader") == "")}

    def save(self, value):
        prior = self.load()
        base = normalize_base(value.get("baseUrl"))
        protocol = value.get("protocol")
        if protocol not in ("gymprogress", "json"):
            raise ValueError("Das API-Format fehlt.")
        auth = value.get("authHeader", "")
        if auth and (not HEADER.fullmatch(auth) or auth.lower() in {"host", "cookie", "content-length", "connection"}):
            raise ValueError("Ungültiger Name für den Authentifizierungsheader.")
        profile = {"baseUrl": base, "protocol": protocol, "authHeader": auth,
                   "authPrefix": str(value.get("authPrefix", ""))[:30], "routes": value.get("routes", {})}
        reusable = base == prior["baseUrl"] and protocol == prior["protocol"]
        for key in SECRET_FIELDS:
            new = value.get(key)
            if new is None:
                new = prior.get(key) if reusable else None
            if new:
                if not isinstance(new, str) or not new.isascii() or any(ord(ch) < 33 for ch in new) or len(new) > 512:
                    raise ValueError("Ein API-Schlüssel enthält ungültige Zeichen.")
                profile[key] = new
        if any(ord(ch) < 32 or ord(ch) > 126 for ch in profile["authPrefix"]):
            raise ValueError("Ungültiger Vorsatz für die Authentifizierung.")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(self.path.name + "." + uuid4().hex)
        try:
            temporary.write_bytes(protect(json.dumps(profile, ensure_ascii=False).encode("utf-8")))
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)
        return self.public()

    def call(self, value):
        profile = self.load()
        if value.get("baseUrl") != profile["baseUrl"] or value.get("protocol") != profile["protocol"]:
            raise ValueError("Die API-Verbindung hat sich geändert. Lade die Ansicht neu.")
        reader, writer = self.credentials(profile)
        role, method, path = value.get("role"), value.get("method"), value.get("path")
        if role not in ("read", "write") or method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            raise ValueError("Die API-Methode ist nicht erlaubt.")
        if (method == "GET") != (role == "read"):
            raise ValueError("Lesen und Schreiben müssen getrennt sein.")
        if not isinstance(path, str) or not path or not re.fullmatch(r"[A-Za-z0-9_.~/-]+", path):
            raise ValueError("Ungültiger relativer API-Pfad.")
        parts = path.split("/")
        if any(part in ("", ".", "..") for part in parts):
            raise ValueError("Ungültiger relativer API-Pfad.")
        protocol = profile["protocol"]
        if protocol == "gymprogress" and path not in ({"data.php"} if role == "read" else {"edit.php", "ingest.php"}):
            raise ValueError("Der Endpunkt gehört nicht zur GymProgress-Schnittstelle.")
        header = "X-GymProgress-Key" if protocol == "gymprogress" else profile.get("authHeader")
        token = reader if role == "read" else writer
        if header and not token:
            raise ValueError("Hinterlege in den Einstellungen den passenden API-Schlüssel.")
        query = value.get("query")
        address = profile["baseUrl"] + "/" + "/".join(quote(part) for part in parts)
        if query:
            address += "?" + urlencode(query)
        headers = {"Accept": "application/json", "User-Agent": "Live-OS/2"}
        if header:
            prefix = "" if protocol == "gymprogress" else profile.get("authPrefix", "")
            headers[header] = prefix + token
        body = value.get("body")
        if body is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        request = Request(address, method=method, headers=headers,
                          data=json.dumps(body).encode("utf-8") if body is not None else None)
        try:
            with self.opener.open(request, timeout=20) as response:
                raw = response.read(MAX_BYTES + 1)
        except HTTPError as error:
            messages = {401: "Der API-Schlüssel wurde abgelehnt.", 403: "Dem Schlüssel fehlt die Berechtigung.",
                        404: "Der API-Endpunkt ist nicht erreichbar (HTTP 404).",
                        409: "Der Wert hat sich geändert. Lade die Daten neu.",
                        422: "Die API akzeptiert diesen Wert oder Datentyp nicht."}
            raise ApiStatus(messages.get(error.code, f"Die API meldet HTTP {error.code}."), error.code) from None
        if len(raw) > MAX_BYTES:
            raise ValueError("Die API-Antwort ist zu groß.")
        try:
            return json.loads(raw) if raw else None
        except ValueError:
            raise ValueError("Der Endpunkt liefert kein JSON.") from None

    def handle(self, action, value):
        if action == "settings":
            return self.public()
        if action == "saveSettings":
            return self.save(value)
        if action == "call":
            return self.call(value)
        if action == "today":
            return datetime.now().astimezone().date().isoformat()
        raise ValueError("Unbekannte App-Aktion.")
