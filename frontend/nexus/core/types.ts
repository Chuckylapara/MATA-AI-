export const AVATAR_STATES = [
  "IDLE", "LISTENING", "THINKING", "SEARCHING", "READING", "ANALYZING", "SPEAKING", "EXCITED", "CALM",
  "CONFUSED", "WARNING", "ERROR", "SUCCESS", "WORKING", "CREATING", "BROWSING",
] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

/** Body pose in avatar space, produced by the vision engine (all angles in radians). */
export interface AvatarRig {
  headYaw: number;
  headPitch: number;
  headRoll: number;
  lean: number;        // forward (+) / back (−)
  bodyRoll: number;
  mouthOpen: number;   // 0..1 (from face blendshapes when tracking)
  blink: number;       // 0..1
  gazeX: number;       // −1..1
  gazeY: number;
  /** Arm joints in avatar space, or null when not tracked. */
  arms: { left: ArmJoints | null; right: ArmJoints | null };
  tracking: boolean;
}

export interface ArmJoints {
  elbow: [number, number, number];   // direction shoulder→elbow (unit)
  wrist: [number, number, number];   // direction elbow→wrist (unit)
  fingers: [number, number, number][] | null; // 21 hand landmarks relative to wrist (avatar units) or null
}

export const neutralRig = (): AvatarRig => ({
  headYaw: 0, headPitch: 0, headRoll: 0, lean: 0, bodyRoll: 0, mouthOpen: 0, blink: 0, gazeX: 0, gazeY: 0,
  arms: { left: null, right: null }, tracking: false,
});

export interface PendingAction {
  action_id: string;
  tool: string;
  preview: Record<string, unknown> | null;
  reason: string;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
  meta?: { provider?: string | null; tools?: { tool: string; ok: boolean; error_code?: string }[]; error?: string };
}
