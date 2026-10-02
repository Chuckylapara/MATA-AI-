// Run: npm run test:nexus   (Node's built-in test runner with type stripping; no extra deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import { OneEuro, OneEuroVec } from "../nexus/vision/oneEuro.ts";
import { ARM_POINTS, GROUP, buildAvatar, fbm, mulberry32, torsoZ } from "../nexus/avatar/geometry.ts";
import { STATE_PARAMS } from "../nexus/avatar/states.ts";
import { dedupeRepeats } from "../nexus/voice/dedupe.ts";

const STATES = ["IDLE", "LISTENING", "THINKING", "SEARCHING", "READING", "ANALYZING", "SPEAKING", "EXCITED", "CALM",
  "CONFUSED", "WARNING", "ERROR", "SUCCESS", "WORKING", "CREATING", "BROWSING",
  "NEUTRAL", "HAPPY", "CURIOUS", "SURPRISED", "SLEEPING", "CAMERA_ACTIVE", "RECORDING", "BUYING", "MESSAGING"];

test("one-euro filter smooths jitter at rest and follows fast motion", () => {
  const f = new OneEuro(1.0, 0.05);
  const rnd = mulberry32(1);
  let out = 0, maxDev = 0;
  for (let i = 0; i < 120; i++) { out = f.filter(1 + (rnd() - 0.5) * 0.2, i / 30); if (i > 30) maxDev = Math.max(maxDev, Math.abs(out - 1)); }
  assert.ok(maxDev < 0.08, `jitter should be damped (max dev ${maxDev})`);
  // step response: reaches most of a large jump within ~0.3 s
  for (let i = 120; i < 130; i++) out = f.filter(5, i / 30);
  assert.ok(out > 4, `should follow fast motion, got ${out}`);
  const v = new OneEuroVec(3);
  assert.equal(v.filter([1, 2, 3], 0).length, 3);
});

test("avatar geometry is deterministic, finite and contains every body group", () => {
  const a = buildAvatar(0.3, 7), b = buildAvatar(0.3, 7);
  assert.equal(a.count, b.count);
  assert.deepEqual(a.position.slice(0, 30), b.position.slice(0, 30));
  assert.ok(a.count > 10000, `enough particles (${a.count})`);
  for (let i = 0; i < a.position.length; i++) assert.ok(Number.isFinite(a.position[i]), "finite positions");
  const groups = new Set(Array.from(a.group));
  for (const g of [GROUP.HEAD, GROUP.HALO, GROUP.NECK, GROUP.TORSO, GROUP.VEINS, GROUP.ENV, GROUP.DUST, GROUP.EYES, GROUP.CORE]) {
    assert.ok(groups.has(g), `group ${g} present`);
  }
  // core + veins are the gold energy
  let goldCore = 0;
  for (let i = 0; i < a.count; i++) if (a.group[i] === GROUP.CORE && a.gold[i] === 1) goldCore++;
  assert.ok(goldCore > 100);
  assert.ok(ARM_POINTS > 0);
});

test("quality scales particle count (graceful degradation)", () => {
  assert.ok(buildAvatar(0.3).count < buildAvatar(0.8).count);
});

test("torso surface is inside the silhouette only", () => {
  assert.ok((torsoZ(0, 0.4) ?? 0) > 0.2);
  assert.equal(torsoZ(1.5, 0.4), null);
  const n = fbm(0.3, 0.7);
  assert.ok(n >= 0 && n <= 1);
});

test("all avatar states have complete parameters", () => {
  assert.deepEqual(Object.keys(STATE_PARAMS).sort(), [...STATES].sort());
  for (const s of STATES) {
    const p = (STATE_PARAMS as any)[s];
    for (const k of ["speed", "turb", "pulse", "glow", "gold", "flow", "scatter", "tintAmt"]) assert.equal(typeof p[k], "number", `${s}.${k}`);
    assert.equal(p.tint.length, 3);
  }
  assert.ok(STATE_PARAMS.ERROR.tintAmt > 0.5 && STATE_PARAMS.WARNING.tintAmt > 0.3, "warning/error are visually distinct");
  assert.ok(STATE_PARAMS.SEARCHING.flow > STATE_PARAMS.IDLE.flow, "searching sends energy outward");
  assert.ok(STATE_PARAMS.THINKING.turb > STATE_PARAMS.IDLE.turb, "thinking is more active");
});

test("iOS repeated transcripts are collapsed", () => {
  assert.equal(dedupeRepeats("Qué es lo que qué es lo que qué es lo qué"), "Qué es lo que");
  assert.equal(dedupeRepeats("hola hola hola"), "hola");
  assert.equal(dedupeRepeats("busca la película busca la película Dune"), "busca la película Dune");
  assert.equal(dedupeRepeats("¿Qué tiempo hace hoy?"), "¿Qué tiempo hace hoy?");
});
