"""Memory engine: write/dedupe/retrieve/scope/expiry/consolidation/extraction."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from mata.common.db import SessionLocal
from mata.nexus.embeddings import Embedder
from mata.nexus.memory import MemoryEngine, MemoryRejected, extract_facts
from mata.nexus.models import MemoryType
from mata.nexus.providers import DevMockProvider
from mata.nexus.router import ModelRouter


def _engine(db, uid):
    return MemoryEngine(db, uid, Embedder(ModelRouter({"mock": DevMockProvider()})))


async def test_write_retrieve_relevant(user_id):
    async with SessionLocal() as db:
        m = _engine(db, user_id)
        await m.write("The user is working on: una empresa de ropa llamada VOIDSAINT", type="project", importance=0.8)
        await m.write("User preference: prefiero respuestas cortas", type="preference")
        await m.write("The user's dog is called Max", type="personal")
        found = await m.search("¿Qué estábamos haciendo con mi empresa?")
        assert found and "VOIDSAINT" in found[0].memory.content
        assert found[0].memory.access_count == 1
        await db.commit()


async def test_dedupe_updates_instead_of_duplicating(user_id):
    async with SessionLocal() as db:
        m = _engine(db, user_id)
        a, created_a = await m.write("The user's name is Erick.", type="personal", importance=0.5)
        b, created_b = await m.write("The user's name is Erick.", type="personal", importance=0.9)
        assert created_a and not created_b and a.id == b.id and b.importance == 0.9
        assert len(await m.list()) == 1


async def test_no_cross_user_leak(user_id, other_user_id):
    async with SessionLocal() as db:
        await _engine(db, user_id).write("Secret project Nebula launches in May", type="project")
        await db.commit()
    async with SessionLocal() as db:
        other = _engine(db, other_user_id)
        assert await other.search("Nebula project launch") == []
        assert await other.list() == []
        mine = await _engine(db, user_id).list()
        assert not await other.delete(mine[0].id)  # cannot delete another user's memory
        assert await other.get(mine[0].id) is None


async def test_expiry_and_consolidation(user_id):
    async with SessionLocal() as db:
        m = _engine(db, user_id)
        st, _ = await m.write("temporary context", type="short_term")
        assert st.expires_at is not None
        await m.write("already gone", type="semantic", expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        assert all(r.memory.content != "already gone" for r in await m.search("already gone", min_score=0))
        result = await m.consolidate()
        assert result["expired_removed"] == 1


async def test_rejects_secrets_and_sensitive_auto_extraction(user_id):
    async with SessionLocal() as db:
        m = _engine(db, user_id)
        with pytest.raises(MemoryRejected):
            await m.write("my api key: sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa")
        with pytest.raises(MemoryRejected):
            await m.write("password is 1234", source="extracted")
        with pytest.raises(MemoryRejected):
            await m.write("   ")


async def test_update_delete_export(user_id):
    async with SessionLocal() as db:
        m = _engine(db, user_id)
        mem, _ = await m.write("likes coffee", type="preference")
        upd = await m.update(mem.id, content="likes green tea", importance=0.9)
        assert upd.content == "likes green tea" and upd.importance == 0.9
        exported = await m.export()
        assert exported[0]["content"] == "likes green tea" and "embedding" not in exported[0]
        assert await m.delete(mem.id)
        assert await m.delete_all() == 0


def test_extract_facts():
    facts = extract_facts("Hola, me llamo erick y estoy creando una empresa de ropa. Prefiero respuestas cortas.")
    types = {f.type for f in facts}
    assert MemoryType.personal in types and MemoryType.project in types and MemoryType.preference in types
    assert next(f for f in facts if f.profile_name).profile_name == "Erick"
    assert extract_facts("My name is Ana") and extract_facts("My name is Ana")[0].profile_name == "Ana"
    assert extract_facts("my password is hunter2, remember that") == []
    assert extract_facts("¿Qué hora es?") == []
