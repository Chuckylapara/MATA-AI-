# NEXUS — Vision & motion mirroring

**Status:** camera + on-device tracking + mirroring **working**; scene/OCR answers **need a vision
model** (shows *Integration not configured* otherwise). Code: `frontend/nexus/vision/`.

## Privacy model
- Starts only from a user click (camera button or Vision panel), after the browser prompt.
- A red `● CAM` indicator is visible whenever a camera track is live; "Turn camera off" stops the
  hardware track. Camera on/off is written to the action feed and audit log.
- MediaPipe runs locally (WASM/GPU); landmarks never leave the device.
- One JPEG frame is uploaded only when you press an ask button (`POST /nexus/vision/ask`), and
  only if CAMERA permission isn't set to Deny.

## Tracking → avatar
| Source | Model | Drives |
|---|---|---|
| Pose (33 world landmarks) | pose_landmarker_lite | arm directions (shoulder→elbow→wrist), body roll |
| Hands (21×2) | hand_landmarker | finger particles (matched to pose wrists, not handedness labels) |
| Face (478 + blendshapes + transform) | face_landmarker | head yaw/pitch/roll, lean (distance), jawOpen → mouth, blinks, gaze |

Smoothing: One-Euro filter per channel (`oneEuro.ts`), plus interpolation in the render loop.
Arms fade in only while tracked. **Mirror mode** off = anatomical (your left hand → avatar's
left hand, as the spec requires); on = mirror-like.

## Ask about the camera
"What am I looking at?", "Read this" (OCR), "What's that object?" or a custom question.

## Limitations
- Head-rotation sign conventions follow MediaPipe's facial transform; if yaw feels inverted on a
  device, toggle mirror mode.
- Hips are usually out of frame on webcams, so lean is estimated from face distance.
- Models (~5–30 MB) are fetched from Google's model storage and jsDelivr on first use.
