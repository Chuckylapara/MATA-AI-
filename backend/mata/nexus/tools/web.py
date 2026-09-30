"""Web intelligence primitives: search provider chain + safe page fetch/extract.

Official/documented APIs only. No paywall/login/DRM bypass. Page fetches are
GET-only, size-capped and blocked from private/loopback networks (SSRF guard).
"""
from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from abc import ABC, abstractmethod
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

from mata.common.config import settings

UA = "NEXUS-AI/0.1 (+https://github.com/chuckylapara/mata-ai-; personal research assistant)"
MAX_BYTES = 1_500_000


class SearchError(RuntimeError):
    pass


@dataclass
class SearchHit:
    title: str
    url: str
    snippet: str
    source: str

    def to_dict(self) -> dict:
        return self.__dict__.copy()


class SearchProvider(ABC):
    name: str

    @property
    @abstractmethod
    def configured(self) -> bool: ...

    @abstractmethod
    async def search(self, query: str, n: int = 6, lang: str = "en") -> list[SearchHit]: ...


class SearxngSearch(SearchProvider):
    name = "searxng"

    @property
    def configured(self) -> bool:
        return bool(settings.searxng_url)

    async def search(self, query: str, n: int = 6, lang: str = "en") -> list[SearchHit]:
        async with httpx.AsyncClient(timeout=15, headers={"User-Agent": UA}) as c:
            r = await c.get(f"{settings.searxng_url.rstrip('/')}/search",
                            params={"q": query, "format": "json", "language": lang})
        if r.status_code != 200:
            raise SearchError(f"searxng HTTP {r.status_code}")
        return [SearchHit(x.get("title", ""), x.get("url", ""), x.get("content", ""), "searxng")
                for x in r.json().get("results", [])[:n]]


class TavilySearch(SearchProvider):
    name = "tavily"

    @property
    def configured(self) -> bool:
        return bool(settings.tavily_api_key)

    async def search(self, query: str, n: int = 6, lang: str = "en") -> list[SearchHit]:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post("https://api.tavily.com/search",
                             headers={"Authorization": f"Bearer {settings.tavily_api_key}"},
                             json={"query": query, "max_results": n})
        if r.status_code != 200:
            raise SearchError(f"tavily HTTP {r.status_code}")
        return [SearchHit(x.get("title", ""), x.get("url", ""), x.get("content", ""), "tavily")
                for x in r.json().get("results", [])[:n]]


class BraveSearch(SearchProvider):
    name = "brave"

    @property
    def configured(self) -> bool:
        return bool(settings.brave_api_key)

    async def search(self, query: str, n: int = 6, lang: str = "en") -> list[SearchHit]:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get("https://api.search.brave.com/res/v1/web/search",
                            headers={"X-Subscription-Token": settings.brave_api_key, "Accept": "application/json"},
                            params={"q": query, "count": n})
        if r.status_code != 200:
            raise SearchError(f"brave HTTP {r.status_code}")
        return [SearchHit(x.get("title", ""), x.get("url", ""), x.get("description", ""), "brave")
                for x in r.json().get("web", {}).get("results", [])[:n]]


_TAG = re.compile(r"<[^>]+>")


class WikipediaSearch(SearchProvider):
    """Official MediaWiki API — keyless and free. Encyclopedic topics only."""

    name = "wikipedia"

    @property
    def configured(self) -> bool:
        return True

    async def search(self, query: str, n: int = 6, lang: str = "en") -> list[SearchHit]:
        lang = lang if lang in {"en", "es", "fr", "it", "pt", "de"} else "en"
        async with httpx.AsyncClient(timeout=15, headers={"User-Agent": UA}) as c:
            r = await c.get(f"https://{lang}.wikipedia.org/w/api.php", params={
                "action": "query", "list": "search", "srsearch": query, "srlimit": n, "format": "json"})
        if r.status_code != 200:
            raise SearchError(f"wikipedia HTTP {r.status_code}")
        hits = []
        for x in r.json().get("query", {}).get("search", [])[:n]:
            title = x.get("title", "")
            hits.append(SearchHit(title, f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}",
                                  _TAG.sub("", x.get("snippet", "")), "wikipedia"))
        return hits


ALL_PROVIDERS: dict[str, SearchProvider] = {
    p.name: p for p in (SearxngSearch(), TavilySearch(), BraveSearch(), WikipediaSearch())
}


def provider_chain() -> list[SearchProvider]:
    names = [n.strip() for n in settings.nexus_search_providers.split(",") if n.strip()]
    return [ALL_PROVIDERS[n] for n in names if n in ALL_PROVIDERS and ALL_PROVIDERS[n].configured]


async def search(query: str, n: int = 6, lang: str = "en") -> tuple[list[SearchHit], list[str]]:
    """Try providers in order. Returns (hits, errors). Raises SearchError if every provider failed."""
    errors: list[str] = []
    for p in provider_chain():
        try:
            hits = await p.search(query, n, lang)
            if hits:
                return hits, errors
            errors.append(f"{p.name}: no results")
        except (httpx.HTTPError, SearchError, ValueError, KeyError) as exc:
            errors.append(f"{p.name}: {exc}")
    if errors and all("no results" in e for e in errors):
        return [], errors
    raise SearchError("All search providers failed: " + "; ".join(errors))


# ---------------------------------------------------------------------------
# Fetch + extract
# ---------------------------------------------------------------------------

class UnsafeURL(ValueError):
    pass


def _is_public_ip(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise UnsafeURL(f"Cannot resolve host {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast \
                or ip.is_unspecified:
            return False
    return True


async def assert_public_url(url: str) -> None:
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise UnsafeURL("Only public http(s) URLs are allowed")
    if u.username or u.password:
        raise UnsafeURL("URLs with credentials are not allowed")
    ok = await asyncio.to_thread(_is_public_ip, u.hostname)
    if not ok:
        raise UnsafeURL("Private, loopback and internal network addresses are blocked")


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "aside", "iframe"}
    BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        if tag == "title":
            self._in_title = True
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self.skip:
            self.parts.append(data)


def html_to_text(html: str) -> tuple[str, str]:
    p = _TextExtractor()
    try:
        p.feed(html)
    except Exception:  # noqa: BLE001 — malformed HTML
        pass
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(p.parts))
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return p.title.strip(), text


async def fetch_page(url: str, max_chars: int = 12000) -> dict:
    await assert_public_url(url)
    async with httpx.AsyncClient(timeout=20, follow_redirects=False, headers={"User-Agent": UA}) as c:
        current = url
        for _ in range(4):  # follow redirects manually so every hop passes the SSRF guard
            r = await c.get(current)
            if r.status_code in (301, 302, 303, 307, 308) and "location" in r.headers:
                current = str(httpx.URL(current).join(r.headers["location"]))
                await assert_public_url(current)
                continue
            break
    if r.status_code in (401, 402, 403):
        return {"url": current, "ok": False, "status": r.status_code,
                "error": "Page requires login or payment — NEXUS does not bypass access controls."}
    if r.status_code != 200:
        return {"url": current, "ok": False, "status": r.status_code, "error": f"HTTP {r.status_code}"}
    ctype = r.headers.get("content-type", "")
    body = r.content[:MAX_BYTES]
    if "html" in ctype or not ctype:
        title, text = html_to_text(body.decode(r.encoding or "utf-8", errors="ignore"))
    elif ctype.startswith("text/") or "json" in ctype:
        title, text = "", body.decode(r.encoding or "utf-8", errors="ignore")
    else:
        return {"url": current, "ok": False, "status": 200, "error": f"Unsupported content type {ctype}"}
    return {"url": current, "ok": True, "status": 200, "title": title[:300], "text": text[:max_chars],
            "truncated": len(text) > max_chars}
