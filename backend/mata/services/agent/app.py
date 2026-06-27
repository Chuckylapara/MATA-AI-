"""Agent service: autonomous task automation with tool calling (ReAct loop).

Uses Anthropic tool-use when ANTHROPIC_API_KEY is set; otherwise a deterministic
mock controller that still exercises the tool registry so the system runs end-to-end.
"""
from __future__ import annotations

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.config import settings
from mata.common.credits import authorize, refund, settle
from mata.common.db import get_db
from mata.common.deps import Identity, get_identity
from mata.common.models import AgentRun, AgentStep, JobStatus
from mata.common.schemas import AgentRequest
from mata.services.agent.tools import TOOLS, anthropic_tool_specs

app = create_app("Agent")


async def _run_with_anthropic(goal: str, max_steps: int, record) -> str:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    messages = [{"role": "user", "content": goal}]
    system = (
        "You are Mata Agent, an autonomous task executor. Use the provided tools to gather "
        "facts before answering. When done, reply with a final answer in plain text."
    )
    for i in range(max_steps):
        resp = await client.messages.create(
            model=settings.agent_model, max_tokens=2048, system=system,
            tools=anthropic_tool_specs(), messages=messages,
        )
        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        text = "".join(b.text for b in resp.content if b.type == "text")
        if not tool_uses:
            await record(i, text, None, None, "final")
            return text
        messages.append({"role": "assistant", "content": resp.content})
        results = []
        for tu in tool_uses:
            tool = TOOLS.get(tu.name)
            try:
                obs = await tool.fn(**tu.input) if tool else f"Unknown tool {tu.name}"
            except Exception as exc:  # noqa: BLE001
                obs = f"Tool error: {exc}"
            await record(i, text, tu.name, tu.input, obs)
            results.append({"type": "tool_result", "tool_use_id": tu.id, "content": obs})
        messages.append({"role": "user", "content": results})
    return "Reached max steps without a final answer."


async def _run_mock(goal: str, max_steps: int, record) -> str:
    """Deterministic demo: try the calculator if the goal looks numeric, else report time."""
    if any(c.isdigit() for c in goal) and any(op in goal for op in "+-*/"):
        expr = "".join(c for c in goal if c in "0123456789+-*/(). ")
        obs = await TOOLS["calculator"].fn(expression=expr.strip())
        await record(0, f"The goal looks arithmetic; computing {expr!r}.", "calculator", {"expression": expr.strip()}, obs)
        return f"The result is {obs}."
    obs = await TOOLS["current_time"].fn()
    await record(0, "Using current_time tool to ground the answer.", "current_time", {}, obs)
    return f"[mock agent] Goal noted: {goal[:120]}. Current time is {obs}. Set ANTHROPIC_API_KEY for full autonomy."


@app.post("/runs")
async def create_run(body: AgentRequest, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    reservation = await authorize(db, identity.user_id, "agent", units=1)
    run = AgentRun(user_id=identity.user_id, goal=body.goal, status=JobStatus.running)
    db.add(run)
    await db.flush()

    step_counter = {"n": 0}

    async def record(index, thought, tool, tool_input, observation):
        db.add(AgentStep(run_id=run.id, index=step_counter["n"], thought=thought, tool=tool, tool_input=tool_input, observation=observation))
        step_counter["n"] += 1
        await db.flush()

    try:
        if settings.anthropic_api_key:
            answer = await _run_with_anthropic(body.goal, body.max_steps, record)
        else:
            answer = await _run_mock(body.goal, body.max_steps, record)
    except Exception as exc:  # noqa: BLE001
        await refund(db, reservation)
        run.status = JobStatus.failed
        run.final_answer = f"Error: {exc}"
        return {"id": run.id, "status": "failed", "error": str(exc)}

    run.status = JobStatus.succeeded
    run.final_answer = answer
    await settle(db, reservation, reservation.amount, meta={"steps": step_counter["n"]})
    return {"id": run.id, "status": "succeeded", "final_answer": answer}


@app.get("/runs/{run_id}")
async def get_run(run_id: str, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(AgentRun).where(AgentRun.id == run_id, AgentRun.user_id == identity.user_id))
    run = res.scalar_one_or_none()
    if not run:
        from fastapi import HTTPException, status as st

        raise HTTPException(st.HTTP_404_NOT_FOUND, "Run not found")
    return {
        "id": run.id,
        "goal": run.goal,
        "status": run.status.value,
        "final_answer": run.final_answer,
        "steps": [
            {"index": s.index, "thought": s.thought, "tool": s.tool, "tool_input": s.tool_input, "observation": s.observation}
            for s in run.steps
        ],
    }
