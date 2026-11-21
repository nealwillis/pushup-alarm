import assert from "node:assert/strict";
import test from "node:test";
import { createRepCounter, elbowAngle } from "../js/rep-counter.js";

const INSTANT = {
  smoothAlpha: 1,
  positionAlpha: 1,
  minDownMs: 0,
  minUpMs: 0,
  settleMs: 1e12,
};

function arm(side, sx, sy, angleDeg, score) {
  const elbow = { x: sx, y: sy + 0.4, score };
  const theta = (side === "left" ? 1 : -1) * ((angleDeg * Math.PI) / 180);
  const vy = -0.4;
  const wx = -vy * Math.sin(theta);
  const wy = vy * Math.cos(theta);
  const wrist = { x: elbow.x + wx, y: elbow.y + wy, score };
  return side === "left"
    ? { leftElbow: elbow, leftWrist: wrist }
    : { rightElbow: elbow, rightWrist: wrist };
}

function makePose({
  elbow = 170,
  leftElbow = null,
  rightElbow = null,
  shoulderY = 0,
  hipX = 0,
  hipY = 1,
  score = 1,
  omit = [],
} = {}) {
  const pose = {
    leftShoulder: { x: -0.2, y: shoulderY, score },
    rightShoulder: { x: 0.2, y: shoulderY, score },
    leftHip: { x: -0.2 + hipX, y: shoulderY + hipY, score },
    rightHip: { x: 0.2 + hipX, y: shoulderY + hipY, score },
    ...arm("left", -0.2, shoulderY, leftElbow ?? elbow, score),
    ...arm("right", 0.2, shoulderY, rightElbow ?? elbow, score),
  };
  for (const key of omit) delete pose[key];
  return pose;
}

const up = (shoulderY = 0, extra = {}) => makePose({ elbow: 170, shoulderY, ...extra });
const down = (shoulderY = 0.4, extra = {}) => makePose({ elbow: 80, shoulderY, ...extra });

function hold(counter, pose, start, ms, dt = 50) {
  let time = start;
  let last = null;
  const frames = Math.max(1, Math.round(ms / dt));
  for (let i = 0; i < frames; i += 1) {
    last = counter.update(pose, time);
    time += dt;
  }
  return { last, time };
}

test("elbow angle is 180 straight and 90 at a right angle", () => {
  const straight = elbowAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 });
  const right = elbowAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 });
  assert.ok(Math.abs(straight - 180) < 1e-6);
  assert.ok(Math.abs(right - 90) < 1e-6);
  assert.equal(elbowAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), null);
});

test("a full down-then-up cycle counts one rep", () => {
  const counter = createRepCounter(INSTANT);
  assert.equal(counter.update(up(), 0).reps, 0);
  const bottom = counter.update(down(), 100);
  assert.equal(bottom.phase, "down");
  assert.equal(bottom.reps, 0);
  const top = counter.update(up(), 200);
  assert.equal(top.counted, true);
  assert.equal(top.reps, 1);
  assert.equal(counter.update(up(), 300).reps, 1);
});

test("two full cycles count two reps and a third down does not", () => {
  const counter = createRepCounter(INSTANT);
  let time = 0;
  counter.update(up(), time);
  for (let rep = 1; rep <= 2; rep += 1) {
    time += 100;
    counter.update(down(), time);
    time += 100;
    const result = counter.update(up(), time);
    assert.equal(result.reps, rep);
  }
  time += 100;
  assert.equal(counter.update(down(), time).reps, 2);
});

test("arm waving bends the elbows but does not count without a body drop", () => {
  const counter = createRepCounter(INSTANT);
  counter.update(up(), 0);
  let time = 50;
  for (let i = 0; i < 12; i += 1) {
    const elbow = i % 2 === 0 ? 60 : 175;
    const result = counter.update(makePose({ elbow, shoulderY: 0 }), time);
    time += 80;
    assert.equal(result.reps, 0);
    assert.notEqual(result.phase, "down");
  }
});

test("bending only one arm does not count", () => {
  const counter = createRepCounter(INSTANT);
  counter.update(up(), 0);
  const waved = counter.update(makePose({ leftElbow: 60, rightElbow: 170, shoulderY: 0.45 }), 100);
  assert.equal(waved.reps, 0);
  assert.notEqual(waved.phase, "down");
  const back = counter.update(up(), 200);
  assert.equal(back.reps, 0);
});

test("a partial bend does not count even if the shoulders drop", () => {
  const counter = createRepCounter(INSTANT);
  counter.update(up(), 0);
  const partial = counter.update(makePose({ elbow: 120, shoulderY: 0.45 }), 100);
  assert.equal(partial.elbowsBent, false);
  assert.equal(partial.reps, 0);
  assert.equal(counter.update(up(), 200).reps, 0);
});

test("shoulders dropping with straight arms does not count", () => {
  const counter = createRepCounter(INSTANT);
  counter.update(up(), 0);
  const bob = counter.update(makePose({ elbow: 170, shoulderY: 0.5 }), 100);
  assert.equal(bob.phase, "up");
  assert.equal(bob.reps, 0);
  assert.equal(counter.update(up(), 200).reps, 0);
});

test("returning only halfway up does not count until the arms lock out", () => {
  const counter = createRepCounter(INSTANT);
  counter.update(up(), 0);
  counter.update(down(), 100);
  const halfway = counter.update(makePose({ elbow: 140, shoulderY: 0 }), 200);
  assert.equal(halfway.reps, 0);
  assert.equal(halfway.phase, "rising");
  counter.update(down(), 300);
  const done = counter.update(up(), 400);
  assert.equal(done.reps, 1);
});

test("a one-frame dip shorter than the dwell time does not count", () => {
  const counter = createRepCounter({ ...INSTANT, minDownMs: 200, minUpMs: 0 });
  counter.update(up(), 0);
  counter.update(down(), 50);
  const back = counter.update(up(), 100);
  assert.equal(back.reps, 0);
  counter.update(down(), 150);
  const held = counter.update(down(), 400);
  assert.equal(held.phase, "down");
  const finished = counter.update(up(), 500);
  assert.equal(finished.reps, 1);
});

test("smoothing ignores a single waved frame and still counts a real rep", () => {
  const counter = createRepCounter();
  let { time } = hold(counter, up(), 0, 600);
  const wave = counter.update(down(0), time);
  assert.equal(wave.reps, 0);
  assert.notEqual(wave.phase, "down");
  time += 50;
  ({ time } = hold(counter, up(), time, 400));
  ({ time } = hold(counter, down(0.45), time, 900));
  const done = hold(counter, up(), time, 700);
  assert.equal(done.last.reps, 1);
});

test("default smoothing rejects an arm-wave and counts five real reps", () => {
  const counter = createRepCounter();
  let time = hold(counter, up(), 0, 500).time;
  for (let i = 0; i < 20; i += 1) {
    const elbow = i % 2 === 0 ? 55 : 175;
    const result = counter.update(makePose({ elbow, shoulderY: 0.02 }), time);
    time += 90;
    assert.equal(result.reps, 0);
  }
  for (let rep = 1; rep <= 5; rep += 1) {
    time = hold(counter, down(0.45), time, 800).time;
    const done = hold(counter, up(), time, 700);
    time = done.time;
    assert.equal(done.last.reps, rep);
  }
});

test("moving closer to a floor camera counts when the elbows also cycle", () => {
  const counter = createRepCounter(INSTANT);
  counter.update(up(0), 0);
  const bottom = counter.update(makePose({ elbow: 80, shoulderY: 0, hipX: 0.95, hipY: 1 }), 100);
  assert.equal(bottom.phase, "down");
  assert.ok(bottom.descent >= 0.15);
  const top = counter.update(up(0), 200);
  assert.equal(top.reps, 1);
});

test("a single visible arm can count only with a deeper body drop", () => {
  const easy = createRepCounter(INSTANT);
  easy.update(up(0, { omit: ["rightElbow", "rightWrist"] }), 0);
  easy.update(down(0.16, { omit: ["rightElbow", "rightWrist"] }), 100);
  assert.equal(easy.update(up(0, { omit: ["rightElbow", "rightWrist"] }), 200).reps, 0);

  const real = createRepCounter(INSTANT);
  real.update(up(0, { omit: ["rightElbow", "rightWrist"] }), 0);
  assert.equal(real.update(down(0.5, { omit: ["rightElbow", "rightWrist"] }), 100).phase, "down");
  assert.equal(real.update(up(0, { omit: ["rightElbow", "rightWrist"] }), 200).reps, 1);
});

test("holding a new top position rebaselines, but a brief lean does not", () => {
  const counter = createRepCounter({ ...INSTANT, settleMs: 200 });
  counter.update(up(0), 0);
  counter.update(up(0), 5000);
  const leaned = counter.update(makePose({ elbow: 170, shoulderY: 0.4 }), 5100);
  assert.ok(leaned.descent > 0.3, `descent was ${leaned.descent}`);
  const still = counter.update(makePose({ elbow: 170, shoulderY: 0.4 }), 5200);
  assert.ok(still.descent > 0.3);
  const settled = counter.update(makePose({ elbow: 170, shoulderY: 0.4 }), 5450);
  assert.ok(settled.descent < 0.05, `settled descent was ${settled.descent}`);
  const tiny = counter.update(makePose({ elbow: 80, shoulderY: 0.48 }), 5500);
  assert.notEqual(tiny.phase, "down");
  assert.equal(counter.update(makePose({ elbow: 170, shoulderY: 0.4 }), 5600).reps, 0);
});

test("missing, low-confidence, and time-reversed samples do not throw or count", () => {
  const counter = createRepCounter(INSTANT);
  assert.equal(counter.update(null, 0).reps, 0);
  assert.equal(counter.update({}, 10).tracking, false);
  assert.equal(counter.update(makePose({ score: 0.05 }), 20).tracking, false);
  counter.update(up(), 100);
  const reversed = counter.update(down(), 50);
  assert.equal(reversed.reps, 0);
  assert.equal(reversed.ignored, "time-went-backwards");
  assert.equal(counter.reps, 0);
});

test("MoveNet keypoints, MoveNet arrays, and MediaPipe arrays all count", () => {
  const named = [up(), down(), up()];
  const times = [0, 100, 200];

  const asKeypoints = named.map((pose) => ({
    keypoints: [
      ["left_shoulder", pose.leftShoulder],
      ["right_shoulder", pose.rightShoulder],
      ["left_elbow", pose.leftElbow],
      ["right_elbow", pose.rightElbow],
      ["left_wrist", pose.leftWrist],
      ["right_wrist", pose.rightWrist],
      ["left_hip", pose.leftHip],
      ["right_hip", pose.rightHip],
    ].map(([name, point]) => ({ name, ...point })),
  }));

  const counter = createRepCounter(INSTANT);
  asKeypoints.forEach((pose, index) => counter.update(pose, times[index]));
  assert.equal(counter.reps, 1);

  const movenet = createRepCounter(INSTANT);
  named.forEach((pose, index) => movenet.update(toIndexArray(pose, MOVE), times[index]));
  assert.equal(movenet.reps, 1);

  const mediapipe = createRepCounter(INSTANT);
  named.forEach((pose, index) => mediapipe.update(toIndexArray(pose, MEDIAPIPE), times[index]));
  assert.equal(mediapipe.reps, 1);
});

const MOVE = {
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
};

const MEDIAPIPE = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
};

function toIndexArray(pose, map) {
  const length = Math.max(...Object.values(map)) + 1;
  const points = Array.from({ length }, () => ({ x: 0, y: 0, score: 0 }));
  for (const [name, index] of Object.entries(map)) points[index] = pose[name];
  return points;
}
