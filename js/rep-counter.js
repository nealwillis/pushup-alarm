/**
 * Pushup rep counter.
 *
 * A rep is one full down-then-up cycle:
 *   - both elbows bend past the down angle (one arm is allowed only with a
 *     deeper shoulder drop, so a wave is not enough)
 *   - the body actually descends (shoulder/hip drop or moving closer to a
 *     floor camera), so arm-waving while standing does not count
 *   - the bottom is held for a short dwell
 *   - both elbows then lock back out
 *
 * Angles and positions are smoothed. Thresholds use hysteresis.
 * Feed it MoveNet/MediaPipe output or plain {leftShoulder, ...} points.
 * Timestamps are milliseconds and must be supplied by the caller (tests
 * pass synthetic clocks).
 */

export const DEFAULTS = {
  downAngle: 100,
  upAngle: 155,
  smoothAlpha: 0.35,
  positionAlpha: 0.5,
  minDownMs: 200,
  minUpMs: 140,
  shoulderDropRatio: 0.15,
  shoulderReturnRatio: 0.1,
  singleArmDropMultiplier: 1.35,
  minScore: 0.35,
  /** Hold the top this long to accept a new body position as the baseline. */
  settleMs: 800,
};

const MOVE_INDEX = {
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
};

const MEDIAPIPE_INDEX = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
};

const NAMED_FROM_KEYPOINT = {
  left_shoulder: "leftShoulder",
  right_shoulder: "rightShoulder",
  left_elbow: "leftElbow",
  right_elbow: "rightElbow",
  left_wrist: "leftWrist",
  right_wrist: "rightWrist",
  left_hip: "leftHip",
  right_hip: "rightHip",
};

export function elbowAngle(shoulder, elbow, wrist) {
  if (!shoulder || !elbow || !wrist) return null;
  const v1x = shoulder.x - elbow.x;
  const v1y = shoulder.y - elbow.y;
  const v2x = wrist.x - elbow.x;
  const v2y = wrist.y - elbow.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (!Number.isFinite(m1) || !Number.isFinite(m2) || m1 < 1e-6 || m2 < 1e-6) return null;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function pointUsable(point, minScore) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const confidence = point.score ?? point.visibility;
  if (confidence == null) return true;
  return Number.isFinite(confidence) && confidence >= minScore;
}

function centroid(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Accept a named landmark object, a MoveNet pose `{keypoints}`, a 17-point
 * MoveNet array, or a 33-point MediaPipe array.
 */
export function normalizeLandmarks(input) {
  if (!input) return null;
  if (Array.isArray(input.keypoints)) {
    const named = {};
    for (const keypoint of input.keypoints) {
      const slot = NAMED_FROM_KEYPOINT[keypoint?.name];
      if (slot) named[slot] = keypoint;
    }
    return named;
  }
  if (Array.isArray(input)) {
    const map = input.length >= 25 ? MEDIAPIPE_INDEX : MOVE_INDEX;
    const named = {};
    for (const [slot, index] of Object.entries(map)) named[slot] = input[index] ?? null;
    return named;
  }
  if (
    input.leftShoulder ||
    input.rightShoulder ||
    input.leftElbow ||
    input.rightElbow ||
    input.leftWrist ||
    input.rightWrist
  ) {
    return input;
  }
  return null;
}

function readSample(landmarks, minScore) {
  const named = normalizeLandmarks(landmarks);
  if (!named) return null;

  const leftAngle = armAngle(named, "left", minScore);
  const rightAngle = armAngle(named, "right", minScore);
  if (leftAngle == null && rightAngle == null) return null;

  const shoulders = [named.leftShoulder, named.rightShoulder].filter((point) => pointUsable(point, minScore));
  if (shoulders.length === 0) return null;
  const shoulder = centroid(shoulders);

  const hips = [named.leftHip, named.rightHip].filter((point) => pointUsable(point, minScore));
  const hip = hips.length ? centroid(hips) : null;

  let scale = hip ? Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) : 0;
  if (!(scale > 1e-4)) {
    const arms = [];
    if (leftAngle != null) arms.push(Math.hypot(named.leftShoulder.x - named.leftElbow.x, named.leftShoulder.y - named.leftElbow.y));
    if (rightAngle != null) arms.push(Math.hypot(named.rightShoulder.x - named.rightElbow.x, named.rightShoulder.y - named.rightElbow.y));
    scale = arms.length ? (arms.reduce((sum, value) => sum + value, 0) / arms.length) * 2 : 0;
  }
  if (!(scale > 1e-4)) return null;

  return {
    leftAngle,
    rightAngle,
    single: leftAngle == null || rightAngle == null,
    arms: (leftAngle == null ? 0 : 1) + (rightAngle == null ? 0 : 1),
    shoulderY: shoulder.y,
    hipY: hip ? hip.y : shoulder.y,
    scale,
  };
}

function armAngle(named, side, minScore) {
  const shoulder = named[`${side}Shoulder`];
  const elbow = named[`${side}Elbow`];
  const wrist = named[`${side}Wrist`];
  if (!pointUsable(shoulder, minScore) || !pointUsable(elbow, minScore) || !pointUsable(wrist, minScore)) return null;
  return elbowAngle(shoulder, elbow, wrist);
}

function mix(previous, value, alpha) {
  if (value == null || Number.isNaN(value)) return null;
  if (previous == null || Number.isNaN(previous)) return value;
  return alpha * value + (1 - alpha) * previous;
}

function descentOf(state) {
  if (state.baseScale == null || state.baseShoulderY == null) return 0;
  const shoulderDrop = (state.shoulderY - state.baseShoulderY) / state.baseScale;
  const hipDrop = state.baseHipY == null ? 0 : (state.hipY - state.baseHipY) / state.baseScale;
  const scaleGrowth = state.baseScale > 0 ? (state.scale - state.baseScale) / state.baseScale : 0;
  return Math.max(shoulderDrop, hipDrop, scaleGrowth);
}

export function createRepCounter(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const state = freshState(cfg.initialReps || 0);

  function captureBaseline() {
    state.baseShoulderY = state.shoulderY;
    state.baseHipY = state.hipY;
    state.baseScale = state.scale;
    state.calibrated = true;
  }

  function snapshot(extra = {}) {
    const bend = combine(state.left, state.right).bend;
    const extend = combine(state.left, state.right).extend;
    const descent = state.calibrated ? descentOf(state) : 0;
    const dropNeed = (state.single ? cfg.singleArmDropMultiplier : 1) * cfg.shoulderDropRatio;
    return {
      reps: state.reps,
      phase: state.phase,
      counted: false,
      tracking: false,
      calibrated: state.calibrated,
      elbowBend: bend,
      elbowExtend: extend,
      descent,
      elbowsBent: bend != null && bend <= cfg.downAngle,
      armsStraight: extend != null && extend >= cfg.upAngle,
      shouldersDown: state.calibrated && descent >= dropNeed,
      arms: state.arms,
      ...extra,
    };
  }

  function update(landmarks, timestamp) {
    if (timestamp != null && state.lastTs != null && timestamp < state.lastTs) {
      return snapshot({ tracking: state.arms > 0, ignored: "time-went-backwards" });
    }
    if (timestamp != null) state.lastTs = timestamp;
    const ts = timestamp ?? 0;

    const sample = readSample(landmarks, cfg.minScore);
    if (!sample) {
      state.arms = 0;
      return snapshot();
    }

    state.left = sample.leftAngle == null ? null : mix(state.left, sample.leftAngle, cfg.smoothAlpha);
    state.right = sample.rightAngle == null ? null : mix(state.right, sample.rightAngle, cfg.smoothAlpha);
    state.shoulderY = mix(state.shoulderY, sample.shoulderY, cfg.positionAlpha);
    state.hipY = mix(state.hipY, sample.hipY, cfg.positionAlpha);
    state.scale = mix(state.scale, sample.scale, cfg.positionAlpha);
    state.single = sample.single;
    state.arms = sample.arms;

    const { bend, extend } = combine(state.left, state.right);
    const dropNeed = (state.single ? cfg.singleArmDropMultiplier : 1) * cfg.shoulderDropRatio;
    const descent = state.calibrated ? descentOf(state) : 0;
    const clearlyUp = extend != null && extend >= cfg.upAngle;
    const clearlyDown = bend != null && bend <= cfg.downAngle && state.calibrated && descent >= dropNeed;
    const backUp = clearlyUp && state.calibrated && descent <= cfg.shoulderReturnRatio;

    if (!state.calibrated) {
      if (clearlyUp) {
        captureBaseline();
        state.phase = "up";
        state.downConfirmed = false;
        state.downSince = null;
        state.upSince = null;
        state.topSince = ts;
      } else {
        state.phase = "waiting";
      }
      return snapshot({ tracking: true });
    }

    if (state.phase === "down" || state.phase === "rising") {
      if (backUp) {
        if (state.upSince == null) state.upSince = ts;
        if (ts - state.upSince >= cfg.minUpMs) {
          state.reps += 1;
          state.phase = "up";
          state.downConfirmed = false;
          state.downSince = null;
          state.upSince = null;
          state.topSince = ts;
          captureBaseline();
          return snapshot({ tracking: true, counted: true });
        }
        state.phase = "rising";
        return snapshot({ tracking: true });
      }
      state.upSince = null;
      state.phase = clearlyDown ? "down" : "rising";
      return snapshot({ tracking: true });
    }

    if (clearlyUp) {
      // Gluing the baseline to a long-held top would also glue it to the first
      // moments of a descent, while the arms still read as straight. Only adopt
      // a new height after it has been held still.
      if (descent <= cfg.shoulderReturnRatio) {
        captureBaseline();
        state.topSince = ts;
        state.settleY = state.shoulderY;
      } else {
        const scale = state.baseScale || 1;
        const moved =
          state.settleY == null || Math.abs(state.shoulderY - state.settleY) / scale > 0.05;
        if (state.topSince == null || moved) {
          state.topSince = ts;
          state.settleY = state.shoulderY;
        } else if (ts - state.topSince >= cfg.settleMs) {
          captureBaseline();
          state.settleY = state.shoulderY;
        }
      }
      state.downSince = null;
      state.phase = "up";
      return snapshot({ tracking: true });
    }

    state.topSince = null;
    state.settleY = null;
    if (clearlyDown) {
      if (state.downSince == null) state.downSince = ts;
      if (ts - state.downSince >= cfg.minDownMs) {
        state.phase = "down";
        state.downConfirmed = true;
        state.upSince = null;
      } else {
        state.phase = "lowering";
      }
    } else {
      state.downSince = null;
      state.phase = "lowering";
    }
    return snapshot({ tracking: true });
  }

  function reset(reps = 0) {
    const next = freshState(reps);
    Object.assign(state, next);
  }

  return {
    update,
    reset,
    get reps() {
      return state.reps;
    },
  };
}

function combine(left, right) {
  if (left != null && right != null) return { bend: Math.max(left, right), extend: Math.min(left, right) };
  const only = left ?? right;
  return { bend: only, extend: only };
}

function freshState(reps) {
  return {
    reps,
    phase: "waiting",
    left: null,
    right: null,
    shoulderY: null,
    hipY: null,
    scale: null,
    baseShoulderY: null,
    baseHipY: null,
    baseScale: null,
    calibrated: false,
    single: false,
    arms: 0,
    downSince: null,
    upSince: null,
    topSince: null,
    settleY: null,
    downConfirmed: false,
    lastTs: null,
  };
}
