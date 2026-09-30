"use client";
// NEXUS vision (Phases 7–8): camera + on-device MediaPipe tracking → AvatarRig.
//
// Privacy: the camera starts only from an explicit user action, the UI shows a live
// CAM indicator while any track is active, and stop() stops the hardware tracks.
// Landmarks are computed locally and never uploaded. A single frame leaves the device
// only when the user asks a vision question (captureFrame()).
import type { ArmJoints, AvatarRig } from "@/nexus/core/types";
import { neutralRig } from "@/nexus/core/types";
import { OneEuro, OneEuroVec } from "@/nexus/vision/oneEuro";
import { bus } from "@/nexus/core/bus";

const MP_VERSION = "1.0.1";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODELS = {
  pose: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
};

export interface TrackingOptions { pose: boolean; hands: boolean; face: boolean; mirror: boolean }
export interface VisionStatus { camera: boolean; tracking: boolean; loading: boolean; error: string | null; fps: number }

type V3 = [number, number, number];
const sub = (a: any, b: any): V3 => [a.x - b.x, a.y - b.y, a.z - b.z];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class VisionEngine {
  video: HTMLVideoElement;
  opts: TrackingOptions = { pose: true, hands: true, face: true, mirror: false };
  facingMode: "user" | "environment" = "user";
  private stream: MediaStream | null = null;
  private pose: any = null;
  private hand: any = null;
  private face: any = null;
  private raf = 0;
  private frame = 0;
  private lastTs = -1;
  private rig: AvatarRig = neutralRig();
  private leanBase: number | null = null;
  private fHead = new OneEuroVec(3, 1.2, 0.05);
  private fBody = new OneEuroVec(1, 0.8, 0.02);
  private fFace = new OneEuroVec(4, 2.0, 0.1);
  private fArms: Record<"left" | "right", OneEuroVec> = { left: new OneEuroVec(6, 1.5, 0.06), right: new OneEuroVec(6, 1.5, 0.06) };
  private fpsAcc = { n: 0, t: performance.now() };
  private lostFrames = 0;
  status: VisionStatus = { camera: false, tracking: false, loading: false, error: null, fps: 0 };

  constructor(private onRig: (rig: AvatarRig) => void, private onStatus: (s: VisionStatus) => void) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
  }

  private setStatus(p: Partial<VisionStatus>) { this.status = { ...this.status, ...p }; this.onStatus(this.status); }

  async startCamera(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) { this.setStatus({ error: "Camera API not available." }); return false; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
      });
    } catch (e: any) {
      this.setStatus({ error: e?.name === "NotAllowedError" ? "Camera permission denied." : `Camera error: ${e?.message || e}` });
      return false;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => null);
    this.setStatus({ camera: true, error: null });
    bus.emit("CAMERA_ENABLED");
    return true;
  }

  async startTracking(): Promise<boolean> {
    if (!this.status.camera && !(await this.startCamera())) return false;
    this.setStatus({ loading: true });
    try {
      const { FilesetResolver, PoseLandmarker, HandLandmarker, FaceLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      const base = (model: string) => ({ baseOptions: { modelAssetPath: model, delegate: "GPU" as const }, runningMode: "VIDEO" as const });
      if (this.opts.pose && !this.pose) this.pose = await PoseLandmarker.createFromOptions(fileset, { ...base(MODELS.pose), numPoses: 1 });
      if (this.opts.hands && !this.hand) this.hand = await HandLandmarker.createFromOptions(fileset, { ...base(MODELS.hand), numHands: 2 });
      if (this.opts.face && !this.face) this.face = await FaceLandmarker.createFromOptions(fileset, {
        ...base(MODELS.face), numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
      });
    } catch (e: any) {
      this.setStatus({ loading: false, error: `Could not load tracking models: ${e?.message || e}` });
      return false;
    }
    this.setStatus({ loading: false, tracking: true, error: null });
    this.loop();
    return true;
  }

  stopTracking() {
    cancelAnimationFrame(this.raf);
    this.rig = neutralRig();
    this.onRig(this.rig);
    this.setStatus({ tracking: false });
  }

  stop() {
    this.stopTracking();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.setStatus({ camera: false });
    bus.emit("CAMERA_DISABLED");
  }

  /** JPEG snapshot (base64, no prefix) for an explicit vision question. */
  captureFrame(maxSide = 1024): string | null {
    if (!this.status.camera || !this.video.videoWidth) return null;
    const s = Math.min(1, maxSide / Math.max(this.video.videoWidth, this.video.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(this.video.videoWidth * s);
    c.height = Math.round(this.video.videoHeight * s);
    c.getContext("2d")!.drawImage(this.video, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82).split(",")[1] ?? null;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const v = this.video;
    if (v.readyState < 2) return;
    const now = performance.now();
    if (now <= this.lastTs) return;
    this.lastTs = now;
    this.frame++;
    const t = now / 1000;
    const m = this.opts.mirror;
    let any = false;

    // --- pose → arms + body roll
    let poseImg: any[] | null = null;
    if (this.pose && this.opts.pose) {
      const r = this.pose.detectForVideo(v, now);
      const w = r.worldLandmarks?.[0];
      poseImg = r.landmarks?.[0] ?? null;
      if (w && poseImg) {
        any = true;
        const arm = (s: number, e: number, wr: number, key: "left" | "right"): ArmJoints | null => {
          const vis = Math.min(poseImg![e].visibility ?? 1, poseImg![wr].visibility ?? 1);
          if (vis < 0.5) return null;
          const toAvatar = (d: V3): V3 => [m ? -d[0] : d[0], -d[1], -d[2]];
          const up = norm(toAvatar(sub(w[e], w[s])));
          const lo = norm(toAvatar(sub(w[wr], w[e])));
          const f = this.fArms[key].filter([...up, ...lo], t);
          return { elbow: norm([f[0], f[1], f[2]]), wrist: norm([f[3], f[4], f[5]]), fingers: null };
        };
        // Pose indices: 11/13/15 = person's left shoulder/elbow/wrist, 12/14/16 = right.
        const personLeft = arm(11, 13, 15, "left"), personRight = arm(12, 14, 16, "right");
        this.rig.arms = m ? { left: personRight, right: personLeft } : { left: personLeft, right: personRight };
        const ls = poseImg[11], rs = poseImg[12];
        const roll = Math.atan2(ls.y - rs.y, ls.x - rs.x);
        this.rig.bodyRoll = this.fBody.filter([clamp(m ? roll : -roll, -0.35, 0.35)], t)[0];
      } else {
        this.rig.arms = { left: null, right: null };
      }
    }

    // --- hands → fingers (matched to pose wrists by image distance, not handedness labels)
    if (this.hand && this.opts.hands && this.frame % 2 === 0) {
      const r = this.hand.detectForVideo(v, now);
      for (let i = 0; i < (r.worldLandmarks?.length ?? 0); i++) {
        const img = r.landmarks[i][0];
        let side: "left" | "right" | null = null;
        if (poseImg) {
          const dl = Math.hypot(img.x - poseImg[15].x, img.y - poseImg[15].y);
          const dr = Math.hypot(img.x - poseImg[16].x, img.y - poseImg[16].y);
          side = dl < dr ? "left" : "right";   // person's side
        }
        if (!side) continue;
        const avatarSide = m ? (side === "left" ? "right" : "left") : side;
        const joints = this.rig.arms[avatarSide];
        if (!joints) continue;
        const wl = r.worldLandmarks[i];
        const scale = 1.9;
        joints.fingers = wl.map((p: any) => [
          (m ? -(p.x - wl[0].x) : p.x - wl[0].x) * scale, -(p.y - wl[0].y) * scale, -(p.z - wl[0].z) * scale,
        ] as V3);
        any = true;
      }
    }

    // --- face → head rotation, lean, mouth, blink, gaze
    if (this.face && this.opts.face && this.frame % 2 === 1) {
      const r = this.face.detectForVideo(v, now);
      const mat = r.facialTransformationMatrixes?.[0]?.data;
      if (mat) {
        any = true;
        const fx = mat[8], fy = mat[9], fz = mat[10];
        let yaw = Math.atan2(fx, fz), pitch = Math.asin(clamp(fy, -1, 1)), roll = Math.atan2(mat[1], mat[0]);
        if (m) { yaw = -yaw; roll = -roll; }
        const [y0, p0, r0] = this.fHead.filter([clamp(yaw, -0.9, 0.9), clamp(pitch, -0.6, 0.6), clamp(roll, -0.5, 0.5)], t);
        this.rig.headYaw = y0; this.rig.headPitch = p0; this.rig.headRoll = r0;
        const tz = mat[14];
        const base = this.leanBase === null ? tz : this.leanBase * 0.998 + tz * 0.002;
        this.leanBase = base;
        this.rig.lean = clamp((tz - base) * 0.012, -0.25, 0.3);
      }
      const bs = r.faceBlendshapes?.[0]?.categories;
      if (bs) {
        const g = (n: string) => bs.find((c: any) => c.categoryName === n)?.score ?? 0;
        const [jaw, blink, gx, gy] = this.fFace.filter([
          g("jawOpen"), (g("eyeBlinkLeft") + g("eyeBlinkRight")) / 2,
          (g("eyeLookOutLeft") - g("eyeLookInLeft") + g("eyeLookInRight") - g("eyeLookOutRight")) / 2,
          (g("eyeLookUpLeft") + g("eyeLookUpRight") - g("eyeLookDownLeft") - g("eyeLookDownRight")) / 2,
        ], t);
        this.rig.mouthOpen = clamp(jaw * 1.4, 0, 1);
        this.rig.blink = clamp(blink, 0, 1);
        this.rig.gazeX = clamp(m ? -gx : gx, -1, 1);
        this.rig.gazeY = clamp(gy, -1, 1);
      }
    }

    this.lostFrames = any ? 0 : this.lostFrames + 1;
    this.rig.tracking = this.lostFrames < 20;
    this.onRig({ ...this.rig, arms: { ...this.rig.arms } });

    this.fpsAcc.n++;
    if (now - this.fpsAcc.t > 1000) {
      this.setStatus({ fps: Math.round((this.fpsAcc.n * 1000) / (now - this.fpsAcc.t)) });
      this.fpsAcc = { n: 0, t: now };
    }
  };

  dispose() {
    this.stop();
    this.pose?.close?.(); this.hand?.close?.(); this.face?.close?.();
  }
}

export { OneEuro };
