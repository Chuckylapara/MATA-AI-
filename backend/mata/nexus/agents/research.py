"""Research agent: understand → queries → search → open sources → extract → compare → cite."""
from __future__ import annotations

from typing import Any

from mata.nexus.agents.base import Agent, AgentResult
from mata.nexus.security import UNTRUSTED_POLICY
from mata.nexus.tools.base import ToolContext

REPORT_SYSTEM = (
    "You are the NEXUS research agent. Write a concise, well-organised research brief in the user's language. "
    "Use ONLY the provided sources. Cite sources inline as [1], [2] matching the numbered list. Point out "
    "contradictions between sources explicitly under 'Conflicts'. If sources are insufficient, say so. "
    + UNTRUSTED_POLICY
)


class ResearchAgent(Agent):
    name = "research"
    description = "Multi-source web research with source comparison, contradiction detection and citations."
    capabilities = ["research", "compare", "summarize", "cite"]
    tools = ["web_search", "web_fetch"]
    phase = 9

    async def run(self, ctx: ToolContext, goal: str, depth: int = 3, lang: str = "en", **_: Any) -> AgentResult:
        from mata.nexus.tools.registry import executor

        queries = await self._queries(ctx, goal)
        await ctx.event("agent", {"agent": self.name, "step": "queries", "queries": queries})
        seen: dict[str, dict] = {}
        errors: list[str] = []
        for q in queries:
            res = await executor.run(ctx, "web_search", {"query": q, "max_results": 5, "lang": lang},
                                     actor=f"agent:{self.name}")
            if not res.ok:
                errors.append(res.error or "search failed")
                continue
            for hit in res.data["results"]:
                seen.setdefault(hit["url"], hit)
        if not seen:
            return AgentResult(False, "No sources found.", {"queries": queries}, "; ".join(errors) or "no results")

        sources = []
        for url, hit in list(seen.items())[: max(1, min(depth, 6))]:
            page = await executor.run(ctx, "web_fetch", {"url": url}, actor=f"agent:{self.name}")
            content = page.data["content"][:3500] if page.ok else hit["snippet"]
            sources.append({"n": len(sources) + 1, "title": hit["title"], "url": url, "content": content,
                            "opened": page.ok})
        await ctx.event("agent", {"agent": self.name, "step": "sources", "count": len(sources)})

        await ctx.event("state", {"state": "ANALYZING"})
        listing = "\n\n".join(f"[{s['n']}] {s['title']} — {s['url']}\n{s['content']}" for s in sources)
        prompt = f"Research goal: {goal}\n\nSources:\n{listing}"
        try:
            res = await ctx.router.chat([{"role": "user", "content": prompt}], system=REPORT_SYSTEM,
                                        role="reasoning", user_id=ctx.user_id, max_tokens=1400, temperature=0.3)
            report = res.text
        except Exception as exc:  # noqa: BLE001
            return AgentResult(False, "Sources collected but synthesis failed.",
                               {"sources": [{k: s[k] for k in ("n", "title", "url")} for s in sources]}, str(exc))
        return AgentResult(True, report, {"queries": queries,
                                          "sources": [{k: s[k] for k in ("n", "title", "url", "opened")}
                                                      for s in sources], "provider_errors": errors})

    async def _queries(self, ctx: ToolContext, goal: str) -> list[str]:
        base = goal.strip()[:200]
        if ctx.router.using_mock:
            return [base]
        try:
            data, _ = await ctx.router.structured(
                [{"role": "user", "content": f"Generate 2-3 diverse web search queries to research: {base}"}],
                {"type": "object", "properties": {"queries": {"type": "array", "items": {"type": "string"}}},
                 "required": ["queries"]}, role="fast", user_id=ctx.user_id)
            qs = [q for q in data.get("queries", []) if isinstance(q, str) and q.strip()][:3]
            return qs or [base]
        except Exception:  # noqa: BLE001
            return [base]
