/** MoveNet loading and skeleton drawing. The model files are served from this app. */

export const POSE_EDGES = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["nose", "left_shoulder"],
  ["nose", "right_shoulder"],
];

const DOTS = new Set([
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
]);

export function modelUrl() {
  return new URL("../models/movenet/model.json", import.meta.url).href;
}

export function librariesReady() {
  return Boolean(globalThis.tf && globalThis.poseDetection?.createDetector);
}

export async function loadDetector(onStatus) {
  const tf = globalThis.tf;
  const poseDetection = globalThis.poseDetection;
  if (!tf || !poseDetection?.createDetector) {
    throw new Error("The pose library did not load. Connect to the internet once and reload.");
  }
  onStatus?.("Starting on-device pose detection…");
  try {
    tf.env().set("WEBGL_PACK", false);
  } catch {
    /* older tf builds */
  }
  await tf.ready();
  try {
    await tf.setBackend("webgl");
    await tf.ready();
  } catch {
    onStatus?.("WebGL failed, using the slower CPU pose model…");
    await tf.setBackend("cpu");
    await tf.ready();
  }
  onStatus?.("Loading the MoveNet model stored in this app…");
  const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    modelUrl: modelUrl(),
    enableSmoothing: false,
  });
  try {
    const warm = document.createElement("canvas");
    warm.width = 192;
    warm.height = 192;
    await detector.estimatePoses(warm, { flipHorizontal: false, maxPoses: 1 });
  } catch {
    /* warmup is best-effort */
  }
  onStatus?.("Pose detection ready.");
  return detector;
}

export function drawSkeleton(ctx, keypoints, width, height) {
  ctx.clearRect(0, 0, width, height);
  if (!keypoints?.length) return;
  const byName = {};
  for (const point of keypoints) byName[point.name] = point;
  ctx.lineWidth = Math.max(3, width / 150);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(182, 242, 207, 0.95)";
  ctx.fillStyle = "rgba(255, 248, 240, 0.95)";
  for (const [startName, endName] of POSE_EDGES) {
    const start = byName[startName];
    const end = byName[endName];
    if (!visible(start) || !visible(end)) continue;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  const radius = Math.max(4, width / 110);
  for (const point of keypoints) {
    if (!DOTS.has(point.name) || !visible(point)) continue;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function visible(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.score == null || point.score >= 0.3);
}
