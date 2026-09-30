"""Long-term memory engine.

Retrieval never dumps history into the prompt: memories are scored with
    0.65·similarity + 0.15·recency + 0.15·importance + 0.05·usage
and only the top-K above a threshold are injected. All operations are scoped to
one user_id; there is no code path that reads another user's memories.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.nexus.embeddings import Embedder, cosine, local_embed
from mata.nexus.models import MemoryType, NexusMemory
from mata.nexus.security import looks_sensitive

DEDUPE_THRESHOLD = 0.92
MIN_SCORE = 0.18
SHORT_TERM_TTL = timedelta(hours=24)
RECENCY_HALF_LIFE_DAYS = 30.0


class MemoryRejected(ValueError):
    pass


@dataclass
class Retrieved:
    memory: NexusMemory
    score: float
    similarity: float


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def serialize(m: NexusMemory) -> dict:
    return {
        "id": m.id, "type": m.type.value, "content": m.content, "tags": m.tags or [], "importance": m.importance,
        "source": m.source, "project_id": m.project_id, "access_count": m.access_count,
        "embedding_model": m.embedding_model,
        "created_at": _aware(m.created_at).isoformat() if m.created_at else None,
        "updated_at": _aware(m.updated_at).isoformat() if m.updated_at else None,
        "expires_at": _aware(m.expires_at).isoformat() if m.expires_at else None,
    }


class MemoryEngine:
    def __init__(self, db: AsyncSession, user_id: str, embedder: Embedder) -> None:
        self.db = db
        self.user_id = user_id
        self.embedder = embedder

    def _alive(self):
        return or_(NexusMemory.expires_at.is_(None), NexusMemory.expires_at > _now())

    async def _similarity(self, qvec: list[float], qmodel: str, qtext: str, m: NexusMemory) -> float:
        if m.embedding and m.embedding_model == qmodel:
            return cosine(qvec, m.embedding)
        # Different/missing embedding model: compare on the local model (never mix vector spaces).
        return cosine(local_embed(qtext), local_embed(m.content))

    async def write(self, content: str, *, type: MemoryType | str = MemoryType.semantic, tags: list[str] | None = None,
                    importance: float = 0.5, source: str = "user", project_id: str | None = None,
                    expires_at: datetime | None = None) -> tuple[NexusMemory, bool]:
        """Store a memory. Returns (memory, created). Near-duplicates update the existing row."""
        content = (content or "").strip()
        if not content:
            raise MemoryRejected("Empty memory")
        if len(content) > 2000:
            content = content[:2000]
        if source != "user" and looks_sensitive(content):
            raise MemoryRejected("Refusing to auto-store sensitive data (credentials, card numbers, …)")
        if looks_sensitive(content) and re.search(r"(?i)(sk-|api[_ ]?key|password|contraseña)\S*\s*[:=]", content):
            raise MemoryRejected("Refusing to store secrets. Use a password manager instead.")
        type = MemoryType(type)
        if type == MemoryType.short_term and expires_at is None:
            expires_at = _now() + SHORT_TERM_TTL
        vec, model = await self.embedder.embed_one(content)

        res = await self.db.execute(select(NexusMemory).where(
            NexusMemory.user_id == self.user_id, NexusMemory.type == type, self._alive()))
        for existing in res.scalars():
            if await self._similarity(vec, model, content, existing) >= DEDUPE_THRESHOLD:
                existing.content = content
                existing.importance = max(existing.importance, importance)
                existing.tags = sorted(set(existing.tags or []) | set(tags or []))
                existing.embedding, existing.embedding_model = vec, model
                existing.updated_at = _now()
                await self.db.flush()
                return existing, False

        mem = NexusMemory(user_id=self.user_id, type=type, content=content, tags=tags or [],
                          importance=max(0.0, min(1.0, importance)), source=source, project_id=project_id,
                          embedding=vec, embedding_model=model, expires_at=expires_at)
        self.db.add(mem)
        await self.db.flush()
        return mem, True

    async def search(self, query: str, *, k: int = 6, types: list[str] | None = None,
                     min_score: float = MIN_SCORE, touch: bool = True) -> list[Retrieved]:
        stmt = select(NexusMemory).where(NexusMemory.user_id == self.user_id, self._alive())
        if types:
            stmt = stmt.where(NexusMemory.type.in_([MemoryType(t) for t in types]))
        rows = list((await self.db.execute(stmt)).scalars())
        if not rows:
            return []
        qvec, qmodel = await self.embedder.embed_one(query)
        now = _now()
        scored: list[Retrieved] = []
        for m in rows:
            sim = await self._similarity(qvec, qmodel, query, m)
            age_days = max(0.0, (now - (_aware(m.updated_at) or _aware(m.created_at) or now)).total_seconds() / 86400)
            recency = math.exp(-math.log(2) * age_days / RECENCY_HALF_LIFE_DAYS)
            usage = min(1.0, math.log1p(m.access_count) / 3)
            score = 0.65 * sim + 0.15 * recency + 0.15 * m.importance + 0.05 * usage
            if sim > 0.08 and score >= min_score:
                scored.append(Retrieved(m, round(score, 4), round(sim, 4)))
        scored.sort(key=lambda r: r.score, reverse=True)
        top = scored[:k]
        if touch:
            for r in top:
                r.memory.access_count += 1
                r.memory.last_accessed_at = now
            await self.db.flush()
        return top

    async def list(self, *, q: str | None = None, type: str | None = None, limit: int = 200) -> list[NexusMemory]:
        if q:
            return [r.memory for r in await self.search(q, k=limit, types=[type] if type else None,
                                                        min_score=0.0, touch=False)]
        stmt = select(NexusMemory).where(NexusMemory.user_id == self.user_id)
        if type:
            stmt = stmt.where(NexusMemory.type == MemoryType(type))
        stmt = stmt.order_by(NexusMemory.created_at.desc()).limit(limit)
        return list((await self.db.execute(stmt)).scalars())

    async def get(self, memory_id: str) -> NexusMemory | None:
        res = await self.db.execute(select(NexusMemory).where(
            NexusMemory.id == memory_id, NexusMemory.user_id == self.user_id))
        return res.scalar_one_or_none()

    async def update(self, memory_id: str, **fields) -> NexusMemory | None:
        m = await self.get(memory_id)
        if not m:
            return None
        if "content" in fields and fields["content"]:
            m.content = fields["content"].strip()[:2000]
            m.embedding, m.embedding_model = await self.embedder.embed_one(m.content)
        if fields.get("type"):
            m.type = MemoryType(fields["type"])
        if fields.get("tags") is not None:
            m.tags = fields["tags"]
        if fields.get("importance") is not None:
            m.importance = max(0.0, min(1.0, float(fields["importance"])))
        m.updated_at = _now()
        await self.db.flush()
        return m

    async def delete(self, memory_id: str) -> bool:
        res = await self.db.execute(delete(NexusMemory).where(
            NexusMemory.id == memory_id, NexusMemory.user_id == self.user_id))
        return (res.rowcount or 0) > 0

    async def delete_all(self) -> int:
        res = await self.db.execute(delete(NexusMemory).where(NexusMemory.user_id == self.user_id))
        return res.rowcount or 0

    async def export(self) -> list[dict]:
        rows = (await self.db.execute(select(NexusMemory).where(NexusMemory.user_id == self.user_id)
                                      .order_by(NexusMemory.created_at))).scalars()
        return [serialize(m) for m in rows]

    async def consolidate(self) -> dict:
        """Drop expired memories and merge near-duplicates (keeps the most important)."""
        expired = await self.db.execute(delete(NexusMemory).where(
            NexusMemory.user_id == self.user_id, NexusMemory.expires_at.is_not(None), NexusMemory.expires_at <= _now()))
        rows = list((await self.db.execute(select(NexusMemory).where(NexusMemory.user_id == self.user_id)
                                           .order_by(NexusMemory.importance.desc()))).scalars())
        kept: list[NexusMemory] = []
        merged = 0
        for m in rows:
            dup = next((k for k in kept if k.type == m.type and
                        cosine(local_embed(k.content), local_embed(m.content)) >= DEDUPE_THRESHOLD), None)
            if dup:
                dup.access_count += m.access_count
                dup.tags = sorted(set(dup.tags or []) | set(m.tags or []))
                await self.db.delete(m)
                merged += 1
            else:
                kept.append(m)
        await self.db.flush()
        return {"expired_removed": expired.rowcount or 0, "merged": merged, "remaining": len(kept)}


# ---------------------------------------------------------------------------
# Rule-based fact extraction (works with no model; an LLM extractor can be layered on top)
# ---------------------------------------------------------------------------

_NAME = re.compile(r"(?i)\b(?:me llamo|mi nombre es|my name is|call me|ll[aá]mame|i am called)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][\wáéíóúñ'\-]{1,30})")
_PROJECT = re.compile(r"(?i)\b(?:estoy (?:creando|construyendo|haciendo|trabajando en)|i(?:'m| am) (?:building|creating|working on|making))\s+(.{3,160})")
_PREFER = re.compile(r"(?i)\b(?:prefiero|me gusta(?:n)?|no me gusta(?:n)?|i prefer|i like|i love|i hate|i don't like)\s+(.{2,160})")
_REMEMBER = re.compile(r"(?i)\b(?:recuerda que|remember that|ten en cuenta que|keep in mind that)\s+(.{3,300})")
_LIVE = re.compile(r"(?i)\b(?:vivo en|i live in)\s+(.{2,80})")
_WORK = re.compile(r"(?i)\b(?:trabajo (?:en|como)|i work (?:at|as|in))\s+(.{2,120})")


@dataclass
class ExtractedFact:
    type: MemoryType
    content: str
    importance: float
    profile_name: str | None = None


def _clean(s: str) -> str:
    return re.split(r"[.!?\n]", s.strip(), maxsplit=1)[0].strip(" ,;")


def extract_facts(text: str) -> list[ExtractedFact]:
    facts: list[ExtractedFact] = []
    if looks_sensitive(text):
        return facts
    if m := _NAME.search(text):
        name = m.group(1).strip().capitalize()
        facts.append(ExtractedFact(MemoryType.personal, f"The user's name is {name}.", 0.95, profile_name=name))
    if m := _PROJECT.search(text):
        facts.append(ExtractedFact(MemoryType.project, f"The user is working on: {_clean(m.group(1))}", 0.8))
    if m := _PREFER.search(text):
        facts.append(ExtractedFact(MemoryType.preference, f"User preference: {_clean(m.group(0))}", 0.6))
    if m := _REMEMBER.search(text):
        facts.append(ExtractedFact(MemoryType.semantic, _clean(m.group(1)), 0.75))
    if m := _LIVE.search(text):
        facts.append(ExtractedFact(MemoryType.personal, f"The user lives in {_clean(m.group(1))}.", 0.7))
    if m := _WORK.search(text):
        facts.append(ExtractedFact(MemoryType.work, f"User work: {_clean(m.group(0))}", 0.7))
    return facts
