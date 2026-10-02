import type { AvatarState } from "@/nexus/core/types";

/** Shader parameters per avatar state. The engine interpolates smoothly between them. */
export interface StateParams {
  speed: number;     // animation speed
  turb: number;      // particle turbulence
  pulse: number;     // brightness pulsing
  glow: number;      // overall glow / bloom
  gold: number;      // intensity of the orange-gold energy
  flow: number;      // energy waves travelling outward through the environment
  scatter: number;   // halo expansion
  tint: [number, number, number];
  tintAmt: number;
  label: string;
}

const NONE: [number, number, number] = [0.3, 0.6, 1.0];

export const STATE_PARAMS: Record<AvatarState, StateParams> = {
  IDLE:      { speed: 0.5, turb: 0.5, pulse: 0.15, glow: 0.65, gold: 0.85, flow: 0.12, scatter: 0.0, tint: NONE, tintAmt: 0, label: "Idle" },
  LISTENING: { speed: 0.6, turb: 0.35, pulse: 0.5, glow: 0.8, gold: 0.8, flow: 0.0, scatter: 0.05, tint: [0.45, 0.85, 1.0], tintAmt: 0.18, label: "Listening" },
  THINKING:  { speed: 1.4, turb: 1.4, pulse: 0.5, glow: 0.9, gold: 1.05, flow: 0.25, scatter: 0.15, tint: NONE, tintAmt: 0, label: "Thinking" },
  SEARCHING: { speed: 1.2, turb: 0.9, pulse: 0.4, glow: 0.95, gold: 1.05, flow: 1.0, scatter: 0.1, tint: NONE, tintAmt: 0, label: "Searching" },
  READING:   { speed: 0.8, turb: 0.5, pulse: 0.3, glow: 0.85, gold: 0.95, flow: 0.55, scatter: 0.05, tint: NONE, tintAmt: 0, label: "Reading" },
  ANALYZING: { speed: 1.1, turb: 1.1, pulse: 0.6, glow: 0.95, gold: 1.15, flow: 0.45, scatter: 0.1, tint: NONE, tintAmt: 0, label: "Analyzing" },
  SPEAKING:  { speed: 0.8, turb: 0.55, pulse: 0.3, glow: 0.9, gold: 1.0, flow: 0.2, scatter: 0.05, tint: NONE, tintAmt: 0, label: "Speaking" },
  EXCITED:   { speed: 1.6, turb: 1.2, pulse: 0.8, glow: 1.15, gold: 1.25, flow: 0.6, scatter: 0.4, tint: NONE, tintAmt: 0, label: "Excited" },
  CALM:      { speed: 0.3, turb: 0.25, pulse: 0.1, glow: 0.55, gold: 0.7, flow: 0.0, scatter: 0.0, tint: NONE, tintAmt: 0, label: "Calm" },
  CONFUSED:  { speed: 0.9, turb: 1.6, pulse: 0.2, glow: 0.6, gold: 0.5, flow: 0.0, scatter: 0.3, tint: [0.62, 0.45, 1.0], tintAmt: 0.3, label: "Confused" },
  WARNING:   { speed: 0.9, turb: 0.8, pulse: 0.9, glow: 0.9, gold: 1.0, flow: 0.1, scatter: 0.1, tint: [1.0, 0.66, 0.1], tintAmt: 0.6, label: "Warning" },
  ERROR:     { speed: 1.0, turb: 1.8, pulse: 0.7, glow: 0.7, gold: 0.4, flow: 0.0, scatter: 0.25, tint: [1.0, 0.12, 0.08], tintAmt: 0.8, label: "Error" },
  SUCCESS:   { speed: 0.9, turb: 0.6, pulse: 0.6, glow: 1.3, gold: 1.55, flow: 0.7, scatter: 0.5, tint: NONE, tintAmt: 0, label: "Success" },
  WORKING:   { speed: 1.0, turb: 0.8, pulse: 0.4, glow: 0.9, gold: 1.0, flow: 0.6, scatter: 0.1, tint: NONE, tintAmt: 0, label: "Working" },
  CREATING:  { speed: 1.2, turb: 1.0, pulse: 0.5, glow: 1.05, gold: 1.35, flow: 0.5, scatter: 0.3, tint: [1.0, 0.55, 0.85], tintAmt: 0.12, label: "Creating" },
  BROWSING:  { speed: 1.0, turb: 0.7, pulse: 0.35, glow: 0.9, gold: 0.95, flow: 0.9, scatter: 0.05, tint: [0.4, 0.9, 1.0], tintAmt: 0.15, label: "Browsing" },
  NEUTRAL:   { speed: 0.5, turb: 0.5, pulse: 0.15, glow: 0.65, gold: 0.85, flow: 0.12, scatter: 0.0, tint: NONE, tintAmt: 0, label: "Neutral" },
  HAPPY:     { speed: 1.0, turb: 0.6, pulse: 0.55, glow: 1.1, gold: 1.2, flow: 0.4, scatter: 0.25, tint: [0.5, 0.95, 1.0], tintAmt: 0.12, label: "Happy" },
  CURIOUS:   { speed: 0.9, turb: 0.8, pulse: 0.4, glow: 0.9, gold: 1.05, flow: 0.3, scatter: 0.12, tint: [0.45, 0.9, 1.0], tintAmt: 0.14, label: "Curious" },
  SURPRISED: { speed: 1.5, turb: 1.3, pulse: 0.9, glow: 1.2, gold: 1.2, flow: 0.7, scatter: 0.55, tint: [0.6, 0.95, 1.0], tintAmt: 0.15, label: "Surprised" },
  SLEEPING:  { speed: 0.2, turb: 0.15, pulse: 0.06, glow: 0.4, gold: 0.5, flow: 0.0, scatter: 0.0, tint: [0.3, 0.5, 0.9], tintAmt: 0.1, label: "Sleeping" },
  CAMERA_ACTIVE: { speed: 0.9, turb: 0.7, pulse: 0.4, glow: 0.95, gold: 1.0, flow: 0.4, scatter: 0.1, tint: [0.45, 0.9, 1.0], tintAmt: 0.14, label: "Looking" },
  RECORDING: { speed: 0.9, turb: 0.7, pulse: 0.9, glow: 0.95, gold: 1.0, flow: 0.2, scatter: 0.08, tint: [1.0, 0.3, 0.3], tintAmt: 0.25, label: "Recording" },
  BUYING:    { speed: 1.0, turb: 0.8, pulse: 0.5, glow: 1.0, gold: 1.35, flow: 0.6, scatter: 0.2, tint: NONE, tintAmt: 0, label: "Shopping" },
  MESSAGING: { speed: 1.0, turb: 0.7, pulse: 0.45, glow: 0.95, gold: 1.0, flow: 0.7, scatter: 0.08, tint: [0.4, 0.9, 1.0], tintAmt: 0.12, label: "Messaging" },
};
