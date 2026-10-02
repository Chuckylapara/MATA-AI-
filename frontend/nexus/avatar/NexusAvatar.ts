"use client";
// NEXUS avatar engine: Three.js + custom GLSL particle shader + bloom.
// Driven by: state (16 presets), speech envelope (lip-sync / pulses), mic level,
// and an AvatarRig (procedural idle motion, or live motion from the vision engine).
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import type { ArmJoints, AvatarRig, AvatarState } from "@/nexus/core/types";
import { neutralRig } from "@/nexus/core/types";
import {
  ARM_POINTS, ARM_RING, ARM_RINGS_PER_BONE, FINGER_PTS, GROUP, HAND_BONES, SHOULDER_L, SHOULDER_R, buildAvatar,
} from "@/nexus/avatar/geometry";
import { STATE_PARAMS, type StateParams } from "@/nexus/avatar/states";

export type Quality = "low" | "medium" | "high";
const QUALITY: Record<Quality, { particles: number; bloom: boolean; pixelRatio: number }> = {
  low: { particles: 0.35, bloom: false, pixelRatio: 1 },
  medium: { particles: 0.65, bloom: true, pixelRatio: 1.25 },
  high: { particles: 1.0, bloom: true, pixelRatio: 2 },
};

const VERT = /* glsl */ `
uniform float uTime, uSpeedTime, uTurb, uPulse, uGlow, uGold, uFlow, uAudio, uMic, uScatter, uMouth, uBreath,
              uBlink, uIntro, uPixelRatio, uSizeScale, uArms, uTintAmt;
uniform vec3 uHeadRot;   // yaw, pitch, roll
uniform vec2 uBody;      // lean, roll
uniform vec2 uGaze;
uniform vec3 uTint;
attribute vec3 aNormal;
attribute float aGold, aGroup, aRand, aSize;
varying vec3 vColor;
varying float vAlpha;

mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
bool isG(float g){ return abs(aGroup - g) < 0.5; }

void main() {
  vec3 p = position;
  vec3 n = aNormal;
  float t = uSpeedTime;
  bool body = aGroup < 4.5 || isG(7.) || isG(8.) || isG(9.);
  bool headish = isG(0.) || isG(1.) || isG(7.) || isG(9.);

  // --- breathing (torso/neck rise, shoulders widen slightly)
  if (isG(2.) || isG(3.) || isG(4.)) {
    float w = smoothstep(-0.3, 0.9, p.y);
    p.y += uBreath * 0.012 * w;
    p.x *= 1.0 + uBreath * 0.006 * w;
  }

  // --- mouth (lip-sync): open the lower face around the mouth line
  if (isG(0.) && p.z > 0.2) {
    float m = exp(-pow(p.x / 0.13, 2.) - pow((p.y - 1.5) / 0.06, 2.));
    p.y += (p.y < 1.5 ? -0.04 : 0.012) * uMouth * m;
    p.z -= 0.01 * uMouth * m;
  }

  // --- eyes: gaze shift + blink
  if (isG(7.)) { p.xy += uGaze * vec2(0.018, 0.01); }

  // --- halo drift / scatter
  if (isG(1.)) {
    vec3 d = normalize(p - vec3(0., 1.76, 0.));
    p += d * (sin(t * 0.6 + aRand * 25.) * 0.025 + uScatter * 0.25 * aRand + uAudio * 0.03 * aRand);
    p.y += sin(t * 0.4 + aRand * 12.) * 0.01;
  }

  // --- turbulence
  vec3 jit = vec3(sin(t * 1.3 + aRand * 40. + p.y * 7.), sin(t * 1.1 + aRand * 23. + p.x * 6.),
                  sin(t * 0.9 + aRand * 31. + p.z * 5.));
  float turbW = isG(5.) ? 0.35 : (isG(6.) ? 2.5 : 1.0);
  p += jit * uTurb * 0.008 * (0.3 + aRand) * turbW;
  if (isG(6.)) p += vec3(sin(t * 0.1 + aRand * 60.), cos(t * 0.13 + aRand * 50.), 0.) * 0.08;

  // --- head rotation around the neck pivot (neck bends partially)
  if (body) {
    float hw = headish ? 1.0 : ((isG(2.) || isG(4.)) ? smoothstep(0.95, 1.36, p.y) : 0.0);
    if (hw > 0.0) {
      vec3 piv = vec3(0., 1.28, 0.);
      mat3 R = rotY(uHeadRot.x * hw) * rotX(-uHeadRot.y * hw) * rotZ(uHeadRot.z * hw);
      p = piv + R * (p - piv);
      n = R * n;
    }
    // body lean/roll around the hips
    vec3 hip = vec3(0., -0.45, 0.);
    mat3 B = rotX(uBody.x) * rotZ(uBody.y);
    p = hip + B * (p - hip);
    n = B * n;
  }

  // --- intro assembly
  vec3 scatterDir = normalize(vec3(sin(aRand * 91.), cos(aRand * 57.), sin(aRand * 33.)));
  float intro = smoothstep(0., 1., clamp(uIntro * 1.4 - aRand * 0.4, 0., 1.));
  p = mix(p + scatterDir * (2.5 + aRand * 3.), p, intro);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 vn = normalize(normalMatrix * n);
  float rim = 1.0 - abs(vn.z);
  rim = rim * rim;

  // --- colour
  vec3 blue = vec3(0.16, 0.48, 1.0);
  vec3 cyan = vec3(0.55, 0.88, 1.0);
  vec3 gold = vec3(1.0, 0.56, 0.14);
  vec3 col = mix(blue, cyan, clamp(rim * 0.9 + aRand * 0.15, 0., 1.));
  float g = clamp(aGold * uGold, 0., 1.);
  // energy waves travelling outward (searching / browsing / success)
  float wave = pow(0.5 + 0.5 * sin(length(p.xz) * 3.5 - t * 5.0 + aRand), 10.) * uFlow;
  if (isG(4.)) g = clamp(g * (0.75 + 0.5 * sin(p.y * 18. + t * 4.)) + wave, 0., 1.);
  if (isG(5.)) g = clamp(g + wave * (0.6 + aGold), 0., 1.);
  col = mix(col, gold, g);
  if (isG(9.)) col = mix(gold, vec3(1.0, 0.78, 0.45), aRand * 0.5);
  col = mix(col, uTint, uTintAmt * (1.0 - g * 0.3));

  float front = smoothstep(-0.35, 0.25, vn.z);           // back-facing particles fade
  float alpha;
  if (isG(0.)) alpha = (0.17 + rim * 0.55) * (0.12 + 0.88 * front) + aGold * 0.2;
  else if (isG(1.)) alpha = 0.18 + 0.22 * aRand;
  else if (isG(2.)) alpha = (0.1 + rim * 0.45) * (0.25 + 0.75 * front);
  else if (isG(3.)) alpha = (0.1 + rim * 0.5) * smoothstep(-0.42, 0.25, position.y);
  else if (isG(4.)) alpha = 0.7;
  else if (isG(5.)) alpha = (0.3 + aGold * 0.6 + wave * 0.5) * smoothstep(-6.5, -1.5, p.z);
  else if (isG(6.)) alpha = 0.1 + aGold * 0.25;
  else if (isG(7.)) alpha = 0.45 * (1.0 - uBlink);
  else if (isG(8.)) alpha = (0.12 + rim * 0.5) * uArms;
  else alpha = 0.16 + 0.14 * (1.0 + uAudio * 2.5);   // core
  alpha *= 1.0 + uPulse * 0.35 * sin(t * 3.0 + p.y * 4.0);
  alpha *= 1.0 + uMic * 0.6 * (headish ? 1.0 : 0.3);
  alpha *= 0.55 + uGlow * 0.5;
  if (g > 0.5) alpha *= 1.0 + uAudio * 1.2;
  vColor = col;
  vAlpha = clamp(alpha, 0., 1.6) * intro;

  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uSizeScale * uPixelRatio * (1.0 + uGlow * 0.2) * 7.0 / max(0.3, -mv.z);
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor, a * a * vAlpha);
}`;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class NexusAvatar {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private material: THREE.ShaderMaterial;
  private body: THREE.Points;
  private arms: THREE.Points;
  private armPos: Float32Array;
  private armNrm: Float32Array;
  private raf = 0;
  private clock = new THREE.Clock();
  private speedTime = 0;
  private state: AvatarState = "IDLE";
  private params: StateParams = { ...STATE_PARAMS.IDLE, tint: [...STATE_PARAMS.IDLE.tint] };
  private audio = 0;
  private audioTarget = 0;
  private mic = 0;
  private rigTarget: AvatarRig = neutralRig();
  private rig: AvatarRig = neutralRig();
  private nextBlink = 2;
  private blinkT = -1;
  private framing: "full" | "tv" = "full";
  private pointer = { x: 0, y: 0 };
  private resizeObs: ResizeObserver;
  private disposed = false;
  fps = 0;
  private fpsAcc = { frames: 0, t: 0 };
  // Automatic performance scaling: drop background particles / pixel ratio / bloom if FPS sags.
  private bodyCount = 0;
  private perfSteps = [1.0, 0.75, 0.5, 0.32];      // ULTRA, HIGH, MEDIUM, LOW (fraction of particles drawn)
  private perfLabels = ["ULTRA", "HIGH", "MEDIUM", "LOW"];
  private perfIdx = 0;
  private perfTimer = 0;
  private perfLowFrames = 0;
  private perfHighFrames = 0;
  perfLevel = "ULTRA";

  constructor(private container: HTMLElement, private quality: Quality = "high") {
    const q = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);
    this.camera.position.set(0, 1.3, 4.4);
    this.camera.lookAt(0, 1.22, 0);

    const buf = buildAvatar(q.particles);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uSpeedTime: { value: 0 }, uTurb: { value: 0.5 }, uPulse: { value: 0.1 },
        uGlow: { value: 0.6 }, uGold: { value: 0.8 }, uFlow: { value: 0 }, uAudio: { value: 0 }, uMic: { value: 0 },
        uScatter: { value: 0 }, uMouth: { value: 0 }, uBreath: { value: 0 }, uBlink: { value: 0 },
        uIntro: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() },
        uSizeScale: { value: quality === "low" ? 1.35 : quality === "medium" ? 1.15 : 1.0 },
        uArms: { value: 0 }, uTintAmt: { value: 0 }, uHeadRot: { value: new THREE.Vector3() },
        uBody: { value: new THREE.Vector2() }, uGaze: { value: new THREE.Vector2() },
        uTint: { value: new THREE.Color(0.3, 0.6, 1) },
      },
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(buf.position, 3));
    g.setAttribute("aNormal", new THREE.BufferAttribute(buf.normal, 3));
    g.setAttribute("aGold", new THREE.BufferAttribute(buf.gold, 1));
    g.setAttribute("aGroup", new THREE.BufferAttribute(buf.group, 1));
    g.setAttribute("aRand", new THREE.BufferAttribute(buf.rand, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(buf.size, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, -1.5), 10);
    this.bodyCount = buf.count;
    this.body = new THREE.Points(g, this.material);
    this.scene.add(this.body);
    this.perfIdx = quality === "high" ? 0 : quality === "medium" ? 1 : 2;
    this.perfLevel = this.perfLabels[this.perfIdx];
    g.setDrawRange(0, Math.floor(buf.count * this.perfSteps[this.perfIdx]));

    // Arms: positions recomputed on the CPU each frame from the rig.
    this.armPos = new Float32Array(ARM_POINTS * 2 * 3);
    this.armNrm = new Float32Array(ARM_POINTS * 2 * 3);
    const ag = new THREE.BufferGeometry();
    const n = ARM_POINTS * 2;
    const rand = new Float32Array(n).map(() => Math.random());
    ag.setAttribute("position", new THREE.BufferAttribute(this.armPos, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setAttribute("aNormal", new THREE.BufferAttribute(this.armNrm, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setAttribute("aGold", new THREE.BufferAttribute(new Float32Array(n), 1));
    ag.setAttribute("aGroup", new THREE.BufferAttribute(new Float32Array(n).fill(GROUP.ARMS), 1));
    ag.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
    ag.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n).map(() => 0.8 + Math.random() * 0.5), 1));
    ag.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 4);
    this.arms = new THREE.Points(ag, this.material);
    this.scene.add(this.arms);

    if (q.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.08);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    window.addEventListener("pointermove", this.onPointer);
    this.clock.start();
    this.loop();
  }

  // ------------------------------------------------------------------ public API
  setState(s: AvatarState) { this.state = s; }
  getState() { return this.state; }
  /** Speech envelope 0..1 (drives lip-sync and core pulses). */
  setAudioLevel(v: number) { this.audioTarget = Math.max(0, Math.min(1, v)); }
  /** Microphone input level 0..1 (listening pulse). */
  setMicLevel(v: number) { this.mic = Math.max(0, Math.min(1, v)); }
  setRig(r: AvatarRig) { this.rigTarget = r; }
  setFraming(f: "full" | "tv") { this.framing = f; this.resize(); }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    window.removeEventListener("pointermove", this.onPointer);
    this.body.geometry.dispose();
    this.arms.geometry.dispose();
    this.material.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------------ internals
  private onPointer = (e: PointerEvent) => {
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // Keep the bust framed on portrait screens (phones) by pulling back.
    const portrait = w / h < 0.8;
    const dist = this.framing === "tv" ? 4.1 : portrait ? 6.4 : 4.4;
    this.camera.position.z = dist;
    this.camera.fov = portrait ? 40 : 34;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.fpsAcc.frames++; this.fpsAcc.t += dt;
    if (this.fpsAcc.t > 0.5) { this.fps = Math.round(this.fpsAcc.frames / this.fpsAcc.t); this.fpsAcc = { frames: 0, t: 0 }; }
    this.autoScale(dt);

    // state interpolation
    const target = STATE_PARAMS[this.state];
    const k = 1 - Math.exp(-dt * 3.2);
    const p = this.params;
    p.speed = lerp(p.speed, target.speed, k); p.turb = lerp(p.turb, target.turb, k);
    p.pulse = lerp(p.pulse, target.pulse, k); p.glow = lerp(p.glow, target.glow, k);
    p.gold = lerp(p.gold, target.gold, k); p.flow = lerp(p.flow, target.flow, k);
    p.scatter = lerp(p.scatter, target.scatter, k); p.tintAmt = lerp(p.tintAmt, target.tintAmt, k);
    for (let i = 0; i < 3; i++) p.tint[i] = lerp(p.tint[i], target.tint[i], k);
    this.speedTime += dt * p.speed;

    // audio envelope: fast attack, slower release
    this.audio = this.audioTarget > this.audio ? lerp(this.audio, this.audioTarget, 0.5) : lerp(this.audio, this.audioTarget, 0.12);

    // rig: live tracking or procedural motion
    const live = this.rigTarget.tracking;
    const proc = this.proceduralRig(t);
    const src = live ? this.rigTarget : proc;
    const rk = 1 - Math.exp(-dt * (live ? 14 : 4));
    const r = this.rig;
    r.headYaw = lerp(r.headYaw, src.headYaw, rk); r.headPitch = lerp(r.headPitch, src.headPitch, rk);
    r.headRoll = lerp(r.headRoll, src.headRoll, rk); r.lean = lerp(r.lean, src.lean, rk);
    r.bodyRoll = lerp(r.bodyRoll, src.bodyRoll, rk); r.gazeX = lerp(r.gazeX, src.gazeX, rk);
    r.gazeY = lerp(r.gazeY, src.gazeY, rk);
    const mouth = live && this.rigTarget.mouthOpen > 0.05 ? this.rigTarget.mouthOpen
      : this.audio * (0.55 + 0.45 * Math.abs(Math.sin(t * 17)));
    r.mouthOpen = lerp(r.mouthOpen, mouth, 0.4);

    // blink (procedural unless tracked)
    let blink = 0;
    if (live) blink = this.rigTarget.blink;
    else {
      if (t > this.nextBlink && this.blinkT < 0) this.blinkT = 0;
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        blink = Math.sin(Math.min(1, this.blinkT / 0.18) * Math.PI);
        if (this.blinkT > 0.18) { this.blinkT = -1; this.nextBlink = t + 2.5 + Math.random() * 4; }
      }
    }

    const u = this.material.uniforms;
    u.uTime.value = t; u.uSpeedTime.value = this.speedTime; u.uTurb.value = p.turb; u.uPulse.value = p.pulse;
    u.uGlow.value = p.glow; u.uGold.value = p.gold; u.uFlow.value = p.flow; u.uScatter.value = p.scatter;
    u.uAudio.value = this.audio; u.uMic.value = this.state === "LISTENING" ? this.mic : this.mic * 0.3;
    u.uMouth.value = r.mouthOpen; u.uBlink.value = blink;
    u.uBreath.value = Math.sin(t * (this.state === "CALM" ? 0.9 : 1.25));
    u.uIntro.value = Math.min(1, t / 2.6);
    u.uTintAmt.value = p.tintAmt; (u.uTint.value as THREE.Color).setRGB(p.tint[0], p.tint[1], p.tint[2]);
    (u.uHeadRot.value as THREE.Vector3).set(r.headYaw, r.headPitch, r.headRoll);
    (u.uBody.value as THREE.Vector2).set(r.lean, r.bodyRoll);
    (u.uGaze.value as THREE.Vector2).set(r.gazeX, r.gazeY);

    const armsVisible = live && (this.rigTarget.arms.left || this.rigTarget.arms.right) ? 1 : 0;
    u.uArms.value = lerp(u.uArms.value, armsVisible, 0.08);
    if (u.uArms.value > 0.01) this.updateArms();

    // camera parallax
    const tv = this.framing === "tv";
    this.camera.position.x = lerp(this.camera.position.x, this.pointer.x * (tv ? 0.05 : 0.18) + Math.sin(t * 0.07) * 0.08, 0.03);
    this.camera.position.y = lerp(this.camera.position.y, 1.3 - this.pointer.y * 0.08, 0.03);
    this.camera.lookAt(0, 1.22, 0);

    if (this.bloom) this.bloom.strength = 0.35 + p.glow * 0.4 + this.audio * 0.2;
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  };

  /** Watch FPS and step quality down (or back up) so the avatar stays smooth on any device. */
  private autoScale(dt: number) {
    this.perfTimer += dt;
    if (this.fps > 0 && this.fps < 42) this.perfLowFrames++; else this.perfLowFrames = 0;
    if (this.fps >= 57) this.perfHighFrames++; else this.perfHighFrames = 0;
    if (this.perfTimer < 2) return;
    this.perfTimer = 0;
    let idx = this.perfIdx;
    if (this.perfLowFrames >= 3 && idx < this.perfSteps.length - 1) idx++;        // sustained low → coarser
    else if (this.perfHighFrames >= 8 && idx > 0) idx--;                          // long smooth spell → finer
    if (idx === this.perfIdx) return;
    this.perfIdx = idx;
    this.perfLevel = this.perfLabels[idx];
    this.perfLowFrames = this.perfHighFrames = 0;
    // Draw fewer particles from the END of the buffer first — that trims background dust and the
    // environment, keeping the head, core, neck and torso (the identity) intact.
    this.body.geometry.setDrawRange(0, Math.floor(this.bodyCount * this.perfSteps[idx]));
    const pr = idx <= 1 ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    if (this.renderer.getPixelRatio() !== pr) {
      this.renderer.setPixelRatio(pr);
      this.composer?.setPixelRatio?.(pr);
      this.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    }
    if (this.bloom) this.bloom.enabled = idx <= 2;      // drop bloom only at LOW
  }

  /** Natural idle / conversational motion when no camera tracking is active. */
  private proceduralRig(t: number): AvatarRig {
    const s = this.state;
    const r = neutralRig();
    r.headYaw = 0.07 * Math.sin(t * 0.31) + 0.03 * Math.sin(t * 0.83);
    r.headPitch = 0.03 * Math.sin(t * 0.47);
    r.headRoll = 0.02 * Math.sin(t * 0.23);
    r.gazeX = Math.sin(t * 0.37) * 0.6; r.gazeY = Math.sin(t * 0.29) * 0.3;
    if (s === "LISTENING") { r.headYaw *= 0.3; r.headRoll = 0.07; r.headPitch = -0.02; r.gazeX *= 0.2; }
    if (s === "THINKING" || s === "ANALYZING") { r.headPitch = 0.1; r.headRoll = -0.06; r.gazeX = 0.8; r.gazeY = 0.6; }
    if (s === "SEARCHING" || s === "BROWSING" || s === "READING") { r.headYaw = 0.18 * Math.sin(t * 0.9); r.headPitch = -0.05; }
    if (s === "SPEAKING") {
      r.headPitch += this.audio * 0.05 * Math.sin(t * 6); r.headYaw *= 0.6;
      r.bodyRoll = 0.012 * Math.sin(t * 1.7); r.lean = 0.02;
    }
    if (s === "CONFUSED") { r.headRoll = 0.14; }
    if (s === "SUCCESS" || s === "EXCITED") { r.headPitch = 0.06; r.lean = -0.02; }
    if (s === "CALM") { r.headYaw *= 0.5; }
    r.lean += (this.pointer.y * -0.01);
    return r;
  }

  private updateArms() {
    const a = this.rigTarget.arms;
    let o = 0;
    o = this.writeArm(a.left, SHOULDER_L as unknown as number[], o);
    o = this.writeArm(a.right, SHOULDER_R as unknown as number[], o);
    const geo = this.arms.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aNormal as THREE.BufferAttribute).needsUpdate = true;
  }

  private writeArm(j: ArmJoints | null, shoulder: number[], offset: number): number {
    const P = this.armPos, N = this.armNrm;
    const count = ARM_POINTS;
    if (!j) { // collapse hidden arm into the shoulder
      for (let i = 0; i < count; i++) { P.set(shoulder, (offset + i) * 3); N.set([0, 0, 1], (offset + i) * 3); }
      return offset + count;
    }
    const upper = 0.56, lower = 0.5;
    const s = new THREE.Vector3(...(shoulder as [number, number, number]));
    const e = s.clone().add(new THREE.Vector3(...j.elbow).multiplyScalar(upper));
    const w = e.clone().add(new THREE.Vector3(...j.wrist).multiplyScalar(lower));
    let idx = offset;
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number) => {
      const dir = b.clone().sub(a);
      const len = dir.length() || 1;
      dir.divideScalar(len);
      const ref = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
      const v = new THREE.Vector3().crossVectors(dir, u).normalize();
      for (let ri = 0; ri < ARM_RINGS_PER_BONE; ri++) {
        const tt = ri / (ARM_RINGS_PER_BONE - 1);
        const c = a.clone().addScaledVector(dir, tt * len);
        const rad = r0 + (r1 - r0) * tt;
        for (let k = 0; k < ARM_RING; k++) {
          const ang = (k / ARM_RING) * Math.PI * 2;
          const nx = u.x * Math.cos(ang) + v.x * Math.sin(ang);
          const ny = u.y * Math.cos(ang) + v.y * Math.sin(ang);
          const nz = u.z * Math.cos(ang) + v.z * Math.sin(ang);
          P[idx * 3] = c.x + nx * rad; P[idx * 3 + 1] = c.y + ny * rad; P[idx * 3 + 2] = c.z + nz * rad;
          N[idx * 3] = nx; N[idx * 3 + 1] = ny; N[idx * 3 + 2] = nz;
          idx++;
        }
      }
    };
    tube(s, e, 0.1, 0.075);
    tube(e, w, 0.072, 0.05);
    // hand
    for (const [i0, i1] of HAND_BONES) {
      const f0 = j.fingers?.[i0] ?? [0, 0, 0], f1 = j.fingers?.[i1] ?? [0, 0, 0];
      for (let k = 0; k < FINGER_PTS; k++) {
        const tt = k / (FINGER_PTS - 1);
        P[idx * 3] = w.x + f0[0] + (f1[0] - f0[0]) * tt;
        P[idx * 3 + 1] = w.y + f0[1] + (f1[1] - f0[1]) * tt;
        P[idx * 3 + 2] = w.z + f0[2] + (f1[2] - f0[2]) * tt;
        N[idx * 3] = 0; N[idx * 3 + 1] = 0; N[idx * 3 + 2] = 1;
        idx++;
      }
    }
    return offset + count;
  }
}
