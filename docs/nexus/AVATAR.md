# NEXUS — Avatar

Code: `frontend/nexus/avatar/` (geometry.ts, states.ts, NexusAvatar.ts).

## Look (matches the reference image)
Procedural particle bust — no mesh assets:
- head of horizontal flowing contour rings with rim lighting and a volumetric **orange core**;
- particle "halo" dissolving from the crown;
- neck lines and **branching gold energy veins** down to the sternum;
- shoulders drawn with offset contour lines and concentric pectoral arcs;
- particle **mountains with gold rivers** on both sides, floating dust, bloom.

## States
IDLE, LISTENING, THINKING, SEARCHING, READING, ANALYZING, SPEAKING, EXCITED, CALM, CONFUSED,
WARNING, ERROR, SUCCESS, WORKING, CREATING, BROWSING — each a preset of speed, turbulence, pulse,
glow, gold intensity, outward energy flow, halo scatter and tint, interpolated smoothly. Server
`state` events and the voice engine drive them.

## Animation
Breathing, blinking, gaze drift, head motion per state (tilt while listening, looking up while
thinking, scanning while searching), nods and micro-shoulder motion while speaking, lip-sync,
intro assembly, pointer parallax. With camera tracking: head, lean, body roll, arms, fingers,
mouth and blinks mirror the user.

Not yet: autonomous hand gestures without tracking (arms are only shown while mirrored).

## Performance
Quality tiers (Settings): high ≈ 90k particles + bloom, medium ≈ 60% + bloom, low ≈ 35% without
bloom. Vertex-shader animation; only arms are updated on the CPU. The hardware endpoint suggests a
particle budget.

## Extending
Add a state: extend `AVATAR_STATES` (core/types.ts) and `STATE_PARAMS`. A glTF/VRM body could
implement the same `setState / setAudioLevel / setRig` API.
