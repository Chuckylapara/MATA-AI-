"""Persistent NEXUS entities. All tables are prefixed `nexus_` and scoped by user_id.

See docs/DATABASE_ARCHITECTURE.md.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from mata.common.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class MemoryType(str, enum.Enum):
    short_term = "short_term"
    conversation = "conversation"
    semantic = "semantic"
    personal = "personal"
    preference = "preference"
    project = "project"
    task = "task"
    relationship = "relationship"
    document = "document"
    work = "work"
    creative = "creative"
    technical = "technical"


class PermissionMode(str, enum.Enum):
    allow = "allow"
    deny = "deny"
    ask = "ask"
    temporary = "temporary"   # allow until expires_at
    trusted = "trusted"       # trusted automation: HIGH-risk may run without asking (rule-bound)


class Risk(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


class PendingStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    rejected = "rejected"
    expired = "expired"
    executed = "executed"
    failed = "failed"


class TaskStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    completed = "completed"
    failed = "failed"


class NexusProfile(Base):
    __tablename__ = "nexus_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(120))
    language: Mapped[str] = mapped_column(String(8), default="auto")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    memory_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class NexusProject(Base):
    __tablename__ = "nexus_projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), default="active")
    summary: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NexusMemory(Base):
    __tablename__ = "nexus_memories"
    __table_args__ = (
        Index("ix_nexus_memories_user_type", "user_id", "type"),
        Index("ix_nexus_memories_user_created", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("nexus_projects.id", ondelete="SET NULL"))
    type: Mapped[MemoryType] = mapped_column(Enum(MemoryType), default=MemoryType.semantic)
    content: Mapped[str] = mapped_column(Text)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    source: Mapped[str] = mapped_column(String(32), default="user")  # user | extracted | tool | consolidated
    embedding: Mapped[list | None] = mapped_column(JSON)
    embedding_model: Mapped[str | None] = mapped_column(String(80))
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class NexusPermission(Base):
    __tablename__ = "nexus_permissions"
    __table_args__ = (UniqueConstraint("user_id", "capability", name="uq_nexus_perm_user_cap"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    capability: Mapped[str] = mapped_column(String(40))
    mode: Mapped[PermissionMode] = mapped_column(Enum(PermissionMode), default=PermissionMode.ask)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class NexusTrustedRule(Base):
    """A deliberate, user-created rule letting one HIGH-risk tool run without asking,
    optionally constrained (e.g. {"to": "juan@example.com"})."""

    __tablename__ = "nexus_trusted_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    tool: Mapped[str] = mapped_column(String(64))
    constraints: Mapped[dict] = mapped_column(JSON, default=dict)
    description: Mapped[str | None] = mapped_column(String(300))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NexusPendingAction(Base):
    __tablename__ = "nexus_pending_actions"
    __table_args__ = (Index("ix_nexus_pending_user_status", "user_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    tool: Mapped[str] = mapped_column(String(64))
    args: Mapped[dict] = mapped_column(JSON, default=dict)
    risk: Mapped[Risk] = mapped_column(Enum(Risk), default=Risk.high)
    preview: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[PendingStatus] = mapped_column(Enum(PendingStatus), default=PendingStatus.pending)
    result: Mapped[dict | None] = mapped_column(JSON)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NexusTask(Base):
    __tablename__ = "nexus_tasks"
    __table_args__ = (Index("ix_nexus_tasks_status_next", "status", "next_run_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(32))  # reminder | web_search | monitor_url | report
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    # schedule: {"type":"once","at":ISO} | {"type":"interval","every_minutes":N}
    schedule: Mapped[dict] = mapped_column(JSON, default=dict)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus), default=TaskStatus.active)
    max_retries: Mapped[int] = mapped_column(Integer, default=2)
    timeout_s: Mapped[int] = mapped_column(Integer, default=60)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NexusTaskRun(Base):
    __tablename__ = "nexus_task_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(ForeignKey("nexus_tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16))  # succeeded | failed
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    output: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NexusActionEvent(Base):
    """Human-readable action feed ("Searching web…", "Draft created", …)."""

    __tablename__ = "nexus_action_events"
    __table_args__ = (Index("ix_nexus_feed_user_created", "user_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NexusAuditLog(Base):
    __tablename__ = "nexus_audit_logs"
    __table_args__ = (Index("ix_nexus_audit_user_created", "user_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    actor: Mapped[str] = mapped_column(String(40))  # user | nexus | agent:<name> | scheduler
    action: Mapped[str] = mapped_column(String(80))
    target: Mapped[str | None] = mapped_column(String(200))
    risk: Mapped[str | None] = mapped_column(String(10))
    outcome: Mapped[str] = mapped_column(String(20))  # ok | denied | failed | pending | rejected
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NexusNotification(Base):
    __tablename__ = "nexus_notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
