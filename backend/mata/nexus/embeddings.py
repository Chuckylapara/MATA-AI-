"""Embeddings: provider embeddings when configured, local hashed fallback otherwise.

The local fallback is a deterministic hashed bag of word unigrams + character
trigrams (256-d, L2-normalised). It needs no model or network and gives useful
lexical/fuzzy similarity, but it is clearly weaker than a neural embedding model —
diagnostics report it as a WARNING.
"""
from __future__ import annotations

import hashlib
import math
import re
import unicodedata

from mata.nexus.providers import ProviderError
from mata.nexus.router import ModelRouter

LOCAL_MODEL = "local-hash-256"
DIM = 256
_WORD = re.compile(r"\w+", re.UNICODE)
_STOP = {
    "el", "la", "los", "las", "un", "una", "de", "del", "y", "o", "que", "en", "a", "mi", "es", "con", "por",
    "para", "lo", "se", "the", "a", "an", "of", "and", "or", "to", "in", "is", "my", "i", "for", "on", "with",
}


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def _bucket(token: str) -> tuple[int, float]:
    h = hashlib.blake2b(token.encode(), digest_size=8).digest()
    idx = int.from_bytes(h[:4], "little") % DIM
    sign = 1.0 if h[4] & 1 else -1.0
    return idx, sign


def local_embed(text: str) -> list[float]:
    vec = [0.0] * DIM
    words = [w for w in _WORD.findall(_norm(text)) if w not in _STOP]
    for w in words:
        i, s = _bucket("w:" + w)
        vec[i] += 2.0 * s
        # crude stemming: prefix feature makes "empresa"/"empresas" collide
        if len(w) > 5:
            i, s = _bucket("p:" + w[:5])
            vec[i] += 1.0 * s
        padded = f"#{w}#"
        for k in range(len(padded) - 2):
            i, s = _bucket("c:" + padded[k : k + 3])
            vec[i] += 0.5 * s
    n = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / n for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


class Embedder:
    def __init__(self, router: ModelRouter) -> None:
        self.router = router

    @property
    def model_id(self) -> str:
        p = self.router.primary("embeddings")
        return f"{p.name}:{p.model_for('embeddings')}" if p else LOCAL_MODEL

    async def embed(self, texts: list[str]) -> tuple[list[list[float]], str]:
        for p in self.router.chain("embeddings"):
            try:
                return await p.embeddings(texts), f"{p.name}:{p.model_for('embeddings')}"
            except ProviderError:
                continue
        return [local_embed(t) for t in texts], LOCAL_MODEL

    async def embed_one(self, text: str) -> tuple[list[float], str]:
        vecs, model = await self.embed([text])
        return vecs[0], model
