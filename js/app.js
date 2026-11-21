import {
  alarmsDue,
  createAlarm,
  formatClock,
  formatDays,
  formatTimeOfDay,
  markRinging,
  owesPushups,
  satisfyAlarm,
  snoozeAlarm,
  soonestAlarm,
} from "./alarms.js";
import { createAlarmAudio } from "./audio.js";
import { drawSkeleton, librariesReady, loadDetector } from "./pose.js";
import { createRepCounter } from "./rep-counter.js";
import { loadState, saveState } from "./store.js";

const DAYS = [
  ["S", "Sunday"],
  ["M", "Monday"],
  ["T", "Tuesday"],
  ["W", "Wednesday"],
  ["T", "Thursday"],
  ["F", "Friday"],
  ["S", "Saturday"],
];

const state = loadState();
const audio = createAlarmAudio();

let armed = false;
let wakeSentinel = null;
let wakeState = "unknown";
let lastScan = Date.now();
let challenge = null;
let counter = null;
let detector = null;
let detectorPromise = null;
let stream = null;
let loopToken = 0;
let editingId = null;
let selectedDays = new Set([1, 2, 3, 4, 5]);
let deleteArmed = false;
let disarmConfirm = false;
let disarmTimer = 0;
let holdRaf = 0;
let doneTimer = 0;
let historyLocked = false;

const ui = {};

function main() {
  for (const id of [
    "dimmer", "viewNight", "viewSettings", "viewChallenge", "httpsBanner", "libBanner", "updateBanner",
    "installBanner", "installDismiss", "reloadApp", "openSettings", "backFromSettings", "clockWrap",
    "clockTime", "clockSeconds", "clockDate", "nextAlarm", "armButton", "practiceButton", "armStatus",
    "addAlarm", "alarmList", "toneChoices", "previewSound", "allowSnooze", "snoozeMinutes", "dimRange",
    "emergencyToggle", "editor", "editorForm", "editorTitle", "alarmTime", "alarmLabel", "alarmPushups",
    "pushMinus", "pushPlus", "dayRow", "dayHint", "editorError", "testAlarm", "cancelEdit", "deleteAlarm",
    "stage", "camVideo", "camCanvas", "camMessage", "cameraHelp", "cameraHelpTitle", "cameraHelpReason",
    "retryCamera", "repCount", "repTarget", "repBar", "challengeLabel", "checkDown", "checkUp", "coach",
    "snoozeButton", "endPractice", "emergencyHold", "soundGate", "gateText", "gateButton", "donePanel", "doneButton",
  ]) {
    ui[id] = document.getElementById(id);
  }

  buildDayButtons();
  bind();
  renderSettings();
  renderAlarms();
  renderArm();
  showBanners();
  tickClock();
  restoreSession();
  preloadModel();
  registerServiceWorker();
  setInterval(tick, 250);
}

function bind() {
  ui.openSettings.addEventListener("click", () => {
    ui.viewSettings.hidden = false;
    ui.viewNight.hidden = true;
    applyDim();
  });
  ui.backFromSettings.addEventListener("click", showNight);
  ui.installDismiss.addEventListener("click", () => {
    state.settings.installHintDismissed = true;
    persist();
    ui.installBanner.hidden = true;
  });
  ui.reloadApp.addEventListener("click", () => location.reload());
  ui.addAlarm.addEventListener("click", () => openEditor(null));
  ui.armButton.addEventListener("click", onArmClick);
  ui.practiceButton.addEventListener("click", onPractice);
  ui.previewSound.addEventListener("click", () => {
    audio.unlock(state.settings.tone);
    audio.preview(state.settings.tone, 1700);
  });
  ui.toneChoices.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tone]");
    if (!button) return;
    state.settings.tone = button.dataset.tone;
    persist();
    renderSettings();
    audio.unlock(state.settings.tone);
  });
  ui.allowSnooze.addEventListener("change", () => {
    state.settings.allowSnooze = ui.allowSnooze.checked;
    persist();
  });
  ui.snoozeMinutes.addEventListener("change", () => {
    state.settings.snoozeMinutes = Number(ui.snoozeMinutes.value);
    persist();
    updateSnoozeLabel();
  });
  ui.dimRange.addEventListener("input", () => {
    state.settings.dim = Number(ui.dimRange.value);
    persist();
    applyDim();
  });
  ui.emergencyToggle.addEventListener("change", () => {
    state.settings.emergencyEnabled = ui.emergencyToggle.checked;
    persist();
  });
  ui.editorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEditor();
  });
  ui.cancelEdit.addEventListener("click", () => ui.editor.close());
  ui.deleteAlarm.addEventListener("click", deleteEditing);
  ui.testAlarm.addEventListener("click", testEditing);
  ui.pushMinus.addEventListener("click", () => stepPushups(-1));
  ui.pushPlus.addEventListener("click", () => stepPushups(1));
  ui.dayRow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-day]");
    if (!button) return;
    const day = Number(button.dataset.day);
    if (selectedDays.has(day)) selectedDays.delete(day);
    else selectedDays.add(day);
    renderDays();
  });
  ui.gateButton.addEventListener("click", onGate);
  ui.retryCamera.addEventListener("click", () => {
    audio.unlock(state.settings.tone);
    if (challenge && challenge.mode !== "practice" && !challenge.done) audio.startAlarm(state.settings.tone);
    openCamera();
  });
  ui.snoozeButton.addEventListener("click", onSnooze);
  ui.endPractice.addEventListener("click", () => {
    if (challenge?.mode === "practice") leaveChallenge();
  });
  ui.doneButton.addEventListener("click", () => {
    if (challenge?.done) leaveChallenge();
  });
  bindHold(ui.emergencyHold);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("beforeunload", (event) => {
    if (challenge && challenge.mode === "alarm" && !challenge.done) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("popstate", onPop);
  window.addEventListener("resize", layoutStage);
}

function buildDayButtons() {
  ui.dayRow.replaceChildren(
    ...DAYS.map(([short, long], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "day";
      button.dataset.day = String(index);
      button.textContent = short;
      button.setAttribute("aria-label", long);
      return button;
    }),
  );
}

function persist() {
  try {
    saveState(state);
  } catch {
    ui.armStatus.textContent = "This browser blocked saving. Alarms may disappear after a reload.";
  }
}

function showNight() {
  ui.viewSettings.hidden = true;
  ui.viewNight.hidden = false;
  applyDim();
}

function showBanners() {
  const host = location.hostname;
  const secure = location.protocol === "https:" || host === "localhost" || host === "127.0.0.1";
  ui.httpsBanner.hidden = secure;
  ui.libBanner.hidden = librariesReady();
  const standalone = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  ui.installBanner.hidden = standalone || state.settings.installHintDismissed;
}

function renderSettings() {
  for (const button of ui.toneChoices.querySelectorAll("[data-tone]")) {
    button.setAttribute("aria-pressed", String(button.dataset.tone === state.settings.tone));
  }
  ui.allowSnooze.checked = state.settings.allowSnooze;
  ui.snoozeMinutes.value = String(state.settings.snoozeMinutes);
  ui.dimRange.value = String(state.settings.dim);
  ui.emergencyToggle.checked = state.settings.emergencyEnabled;
  updateSnoozeLabel();
}

function updateSnoozeLabel() {
  const minutes = state.settings.snoozeMinutes;
  ui.snoozeButton.textContent = `Snooze ${minutes} min — pushups still required`;
}

function renderAlarms() {
  ui.alarmList.replaceChildren();
  if (state.alarms.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No alarms yet. Add one for the morning, then tap Arm alarm.";
    ui.alarmList.append(empty);
    return;
  }
  for (const alarm of state.alarms) {
    const item = document.createElement("li");
    item.className = alarm.enabled ? "alarm-card" : "alarm-card is-off";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "alarm-open";
    const time = document.createElement("span");
    time.className = "alarm-time";
    time.textContent = formatTimeOfDay(alarm.time);
    const label = document.createElement("span");
    label.className = "alarm-label";
    label.textContent = alarm.label;
    const meta = document.createElement("span");
    meta.className = "alarm-meta";
    const owed = alarm.openOccurrence ? " · pushups still required" : "";
    meta.textContent = `${formatDays(alarm.days)} · ${alarm.pushups} pushups${owed}`;
    open.append(time, label, meta);
    open.addEventListener("click", () => openEditor(alarm.id));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "switch";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(alarm.enabled));
    toggle.setAttribute("aria-label", `${alarm.enabled ? "Turn off" : "Turn on"} ${alarm.label}`);
    toggle.addEventListener("click", () => toggleAlarm(alarm.id));
    item.append(open, toggle);
    ui.alarmList.append(item);
  }
}

function toggleAlarm(id) {
  const alarm = state.alarms.find((item) => item.id === id);
  if (!alarm) return;
  if (alarm.enabled && alarm.openOccurrence) {
    ui.armStatus.textContent = "Finish the pushups before turning this alarm off.";
    return;
  }
  alarm.enabled = !alarm.enabled;
  persist();
  renderAlarms();
  tickClock();
}

function renderArm() {
  const owed = state.alarms.some((alarm) => alarm.openOccurrence);
  ui.armButton.textContent = armed ? (disarmConfirm ? "Tap again to disarm" : "Disarm") : "Arm alarm";
  document.body.classList.toggle("is-armed", armed);
  if (!armed) {
    ui.armStatus.textContent = "Tap Arm alarm before bed. That unlocks the loud sound and asks the iPad to keep the screen on.";
    return;
  }
  if (owed && !challenge) {
    ui.armStatus.textContent = "Snoozed. The pushups are still required when it rings again.";
    return;
  }
  if (wakeState === "on") ui.armStatus.textContent = "Armed. Screen stay-awake is on and sound is unlocked.";
  else if (wakeState === "unsupported") ui.armStatus.textContent = "Armed and sound is unlocked. This browser cannot hold the screen awake — set Auto-Lock to Never.";
  else ui.armStatus.textContent = "Armed and sound is unlocked. If the screen still sleeps, set Auto-Lock to Never.";
}

function tickClock() {
  const now = new Date();
  ui.clockTime.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  ui.clockSeconds.textContent = String(now.getSeconds()).padStart(2, "0");
  ui.clockDate.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const next = soonestAlarm(state.alarms, now.getTime());
  if (!next) {
    ui.nextAlarm.textContent = "No alarm is turned on.";
  } else {
    const snoozed = next.alarm.snoozeUntil != null && next.alarm.snoozeUntil > now.getTime();
    const when = formatUpcoming(next.at, now);
    const prefix = snoozed ? "Snoozed · " : "Next · ";
    ui.nextAlarm.textContent = `${prefix}${when} · ${next.alarm.label} · ${next.alarm.pushups} pushups`;
  }
  if (armed) {
    const shift = ((now.getMinutes() % 5) - 2) * 8;
    ui.clockWrap.style.transform = `translate(${shift}px, ${(now.getMinutes() % 3) * 5}px)`;
  } else {
    ui.clockWrap.style.transform = "";
  }
  applyDim();
}

function formatUpcoming(ms, now) {
  const when = new Date(ms);
  const today = new Date(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const time = formatClock(ms);
  if (when.toDateString() === today.toDateString()) return `Today ${time}`;
  if (when.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${when.toLocaleDateString([], { weekday: "long" })} ${time}`;
}

function applyDim() {
  const nightVisible = !ui.viewNight.hidden && ui.viewChallenge.hidden;
  ui.dimmer.style.opacity = armed && nightVisible ? String(state.settings.dim) : "0";
}

function onArmClick() {
  if (armed) {
    if (state.alarms.some((alarm) => alarm.openOccurrence)) {
      ui.armStatus.textContent = "Pushups are still required, so this stays armed.";
      return;
    }
    if (!disarmConfirm) {
      disarmConfirm = true;
      renderArm();
      clearTimeout(disarmTimer);
      disarmTimer = setTimeout(() => {
        disarmConfirm = false;
        renderArm();
      }, 3500);
      return;
    }
    armed = false;
    disarmConfirm = false;
    releaseWake();
    renderArm();
    applyDim();
    return;
  }
  audio.unlock(state.settings.tone);
  armed = true;
  disarmConfirm = false;
  acquireWake();
  renderArm();
  applyDim();
}

async function acquireWake() {
  if (!("wakeLock" in navigator)) {
    wakeState = "unsupported";
    renderArm();
    return;
  }
  try {
    wakeSentinel = await navigator.wakeLock.request("screen");
    wakeState = "on";
    wakeSentinel.addEventListener("release", () => {
      if (wakeState === "on") wakeState = "off";
      renderArm();
    });
  } catch {
    wakeState = "off";
  }
  renderArm();
}

function releaseWake() {
  wakeState = "unknown";
  wakeSentinel?.release().catch(() => {});
  wakeSentinel = null;
}

function onVisible() {
  if (document.visibilityState !== "visible") return;
  if (armed) acquireWake();
  if (challenge && challenge.mode !== "practice" && !challenge.done && !audio.isReady()) {
    ui.soundGate.hidden = false;
  }
}

function tick() {
  tickClock();
  const now = Date.now();
  const due = alarmsDue(state.alarms, lastScan, now);
  lastScan = now;
  if (due.length) {
    for (const item of due) {
      const index = state.alarms.findIndex((alarm) => alarm.id === item.id);
      if (index < 0) continue;
      state.alarms[index] = markRinging(state.alarms[index], item.kind === "snooze" ? state.alarms[index].openOccurrence ?? item.at : item.at);
    }
    persist();
    renderAlarms();
  }
  if (!challenge) {
    const owed = state.alarms.find((alarm) => owesPushups(alarm, now));
    if (owed) beginChallenge({ mode: "alarm", alarm: owed, fromGesture: false });
  }
}

function restoreSession() {
  const session = state.session;
  if (session?.mode === "alarm") {
    const alarm = state.alarms.find((item) => item.id === session.alarmId);
    if (alarm) {
      beginChallenge({
        mode: "alarm",
        alarm,
        fromGesture: false,
        reps: session.reps,
        target: session.target,
        label: session.label,
      });
      return;
    }
    state.session = null;
    persist();
  }
  const owed = state.alarms.find((alarm) => owesPushups(alarm, Date.now()));
  if (owed) beginChallenge({ mode: "alarm", alarm: owed, fromGesture: false });
}

function onPractice() {
  const next = soonestAlarm(state.alarms, Date.now());
  beginChallenge({
    mode: "practice",
    fromGesture: true,
    target: next?.alarm.pushups ?? 10,
    label: "Practice",
  });
}

function openEditor(id) {
  editingId = id;
  deleteArmed = false;
  const alarm = id ? state.alarms.find((item) => item.id === id) : null;
  ui.editorTitle.textContent = alarm ? "Edit alarm" : "New alarm";
  ui.alarmTime.value = alarm?.time || "06:30";
  ui.alarmLabel.value = alarm?.label || "";
  ui.alarmPushups.value = String(alarm?.pushups ?? 10);
  selectedDays = new Set(alarm ? alarm.days : [1, 2, 3, 4, 5]);
  ui.deleteAlarm.hidden = !alarm;
  ui.deleteAlarm.textContent = "Delete";
  ui.editorError.textContent = "";
  renderDays();
  ui.editor.showModal();
  ui.alarmTime.focus();
}

function renderDays() {
  for (const button of ui.dayRow.querySelectorAll("[data-day]")) {
    button.setAttribute("aria-pressed", String(selectedDays.has(Number(button.dataset.day))));
  }
  ui.dayHint.textContent = selectedDays.size === 0
    ? "No days selected means it rings once, then turns off."
    : formatDays([...selectedDays]);
}

function stepPushups(delta) {
  const next = Math.min(200, Math.max(1, Number(ui.alarmPushups.value || 10) + delta));
  ui.alarmPushups.value = String(next);
}

function readForm() {
  const existing = editingId ? state.alarms.find((alarm) => alarm.id === editingId) : null;
  const alarm = createAlarm({
    id: existing?.id,
    time: ui.alarmTime.value,
    label: ui.alarmLabel.value,
    pushups: ui.alarmPushups.value,
    days: [...selectedDays],
    enabled: existing ? existing.enabled : true,
    lastSatisfiedAt: existing?.lastSatisfiedAt ?? null,
    openOccurrence: existing?.openOccurrence ?? null,
    snoozeUntil: existing?.snoozeUntil ?? null,
  });
  if (!alarm) {
    ui.editorError.textContent = "Enter a valid time.";
    return null;
  }
  ui.editorError.textContent = "";
  return alarm;
}

function saveEditor() {
  const alarm = readForm();
  if (!alarm) return;
  const index = state.alarms.findIndex((item) => item.id === alarm.id);
  if (index >= 0) state.alarms[index] = alarm;
  else state.alarms.push(alarm);
  state.alarms.sort((a, b) => a.time.localeCompare(b.time));
  persist();
  ui.editor.close();
  renderAlarms();
  tickClock();
}

function deleteEditing() {
  const existing = state.alarms.find((alarm) => alarm.id === editingId);
  if (!existing) return;
  if (existing.openOccurrence) {
    ui.editorError.textContent = "This alarm still owes pushups.";
    return;
  }
  if (!deleteArmed) {
    deleteArmed = true;
    ui.deleteAlarm.textContent = "Confirm delete";
    return;
  }
  state.alarms = state.alarms.filter((alarm) => alarm.id !== editingId);
  persist();
  ui.editor.close();
  renderAlarms();
  tickClock();
}

function testEditing() {
  const alarm = readForm();
  if (!alarm) return;
  ui.editor.close();
  beginChallenge({
    mode: "test",
    fromGesture: true,
    target: alarm.pushups,
    label: `${alarm.label} test`,
  });
}

function beginChallenge({ mode, alarm = null, fromGesture, reps = 0, target, label }) {
  clearTimeout(doneTimer);
  const pushups = target ?? alarm?.pushups ?? 10;
  challenge = {
    mode,
    alarmId: alarm?.id ?? null,
    target: pushups,
    occurrenceAt: alarm?.openOccurrence ?? null,
    label: label || alarm?.label || "Alarm",
    done: false,
  };
  counter = createRepCounter({ initialReps: reps });
  ui.viewChallenge.hidden = false;
  ui.donePanel.hidden = true;
  ui.cameraHelp.hidden = true;
  ui.camMessage.textContent = "Prop the iPad on the floor or against a wall, facing you, so your arms and shoulders stay in frame.";
  document.body.classList.add("in-challenge");
  ui.viewNight.inert = true;
  ui.viewSettings.inert = true;
  if (!historyLocked) {
    history.pushState({ pushupChallenge: true }, "");
    historyLocked = true;
  }
  if (mode === "alarm") syncSession();
  updateChallengeHud(null);
  document.title = mode === "practice" ? "Practice · Pushup Alarm" : "Pushups · Pushup Alarm";
  const tone = state.settings.tone;
  if (fromGesture) {
    audio.unlock(tone);
    if (mode !== "practice") audio.startAlarm(tone);
    else audio.blip(740);
    ui.soundGate.hidden = true;
    openCamera();
    return;
  }
  if (audio.isReady()) {
    if (mode !== "practice") audio.startAlarm(tone);
    ui.soundGate.hidden = true;
    openCamera();
    return;
  }
  ui.gateText.textContent = "Tap to sound the alarm and open the camera. This does not turn it off. The pushups are still required.";
  ui.soundGate.hidden = false;
}

function onGate() {
  if (!challenge || challenge.done) return;
  audio.unlock(state.settings.tone);
  if (challenge.mode !== "practice") audio.startAlarm(state.settings.tone);
  ui.soundGate.hidden = true;
  openCamera();
}

function onPop() {
  if (challenge && challenge.mode !== "practice" && !challenge.done) {
    history.pushState({ pushupChallenge: true }, "");
    return;
  }
  historyLocked = false;
  if (challenge) leaveChallenge();
}

async function openCamera() {
  if (!challenge) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraHelp("Camera is unavailable", "This page is not allowed to use the camera. Open it over HTTPS.");
    return;
  }
  ui.cameraHelp.hidden = true;
  ui.camMessage.textContent = "Opening the front camera…";
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    stream = media;
  } catch (error) {
    const name = error?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      showCameraHelp("Camera permission is off", "The browser blocked the camera. The alarm keeps going until the pushups are done.");
    } else if (name === "NotFoundError") {
      showCameraHelp("No camera found", "This iPad did not report a camera the page can use.");
    } else if (name === "NotReadableError") {
      showCameraHelp("Camera is busy", "Another app is using the camera. Close it, then try again.");
    } else {
      showCameraHelp("Camera did not start", "Tap Try again. If the iPad asked for permission, choose Allow.");
    }
    return;
  }
  const video = ui.camVideo;
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch {
    /* the gesture path usually succeeds; the retry button covers the rest */
  }
  ui.camMessage.textContent = "";
  startLoop();
}

function showCameraHelp(title, reason) {
  ui.cameraHelp.hidden = false;
  ui.cameraHelpTitle.textContent = title;
  ui.cameraHelpReason.textContent = reason;
  ui.camMessage.textContent = "";
}

function startLoop() {
  const token = ++loopToken;
  let busy = false;
  const run = async () => {
    if (token !== loopToken) return;
    if (!busy && ui.camVideo.readyState >= 2 && challenge && !challenge.done) {
      busy = true;
      try {
        const det = await ensureDetector();
        if (token !== loopToken || !counter) return;
        layoutStage();
        const poses = await det.estimatePoses(ui.camVideo, { flipHorizontal: false, maxPoses: 1 });
        if (token !== loopToken || !counter) return;
        const pose = poses?.[0];
        const context = ui.camCanvas.getContext("2d");
        drawSkeleton(context, pose?.keypoints, ui.camCanvas.width, ui.camCanvas.height);
        const sample = counter.update(pose || null, performance.now());
        applySample(sample);
      } catch (error) {
        if (token === loopToken) {
          ui.camMessage.textContent = error?.message || "Pose detection hit a problem. Keep your upper body in frame.";
        }
      } finally {
        busy = false;
      }
    }
    if (token === loopToken) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

function layoutStage() {
  const video = ui.camVideo;
  const canvas = ui.camCanvas;
  const box = ui.stage.getBoundingClientRect();
  const sourceWidth = video.videoWidth || 640;
  const sourceHeight = video.videoHeight || 480;
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
  const width = Math.max(1, sourceWidth * scale);
  const height = Math.max(1, sourceHeight * scale);
  const left = (box.width - width) / 2;
  const top = (box.height - height) / 2;
  for (const element of [video, canvas]) {
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }
  if (canvas.width !== sourceWidth) canvas.width = sourceWidth;
  if (canvas.height !== sourceHeight) canvas.height = sourceHeight;
}

function applySample(sample) {
  if (!challenge || challenge.done) return;
  if (sample.counted) {
    audio.blip();
    if (navigator.vibrate) navigator.vibrate(35);
    ui.repCount.classList.remove("pop");
    void ui.repCount.offsetWidth;
    ui.repCount.classList.add("pop");
    if (challenge.mode === "alarm") syncSession();
  }
  updateChallengeHud(sample);
  if (counter.reps >= challenge.target) finishChallenge();
}

function updateChallengeHud(sample) {
  if (!challenge) return;
  const reps = counter?.reps ?? 0;
  ui.repCount.textContent = String(reps);
  ui.repTarget.textContent = `/ ${challenge.target}`;
  const partial = sample && (sample.phase === "down" || sample.phase === "rising") ? 0.5 : 0;
  ui.repBar.style.width = `${Math.min(100, ((reps + partial) / challenge.target) * 100)}%`;
  ui.challengeLabel.textContent = challenge.label;
  ui.coach.textContent = coachText(sample);
  ui.checkDown.classList.toggle("is-met", Boolean(sample?.elbowsBent && sample?.shouldersDown));
  ui.checkUp.classList.toggle("is-met", Boolean(sample?.armsStraight));
  ui.viewChallenge.classList.toggle("is-ringing", challenge.mode !== "practice" && !challenge.done);
  ui.viewChallenge.classList.toggle("is-complete", Boolean(challenge.done));
  ui.endPractice.hidden = challenge.mode !== "practice" || challenge.done;
  ui.snoozeButton.hidden = challenge.mode !== "alarm" || challenge.done || !state.settings.allowSnooze;
  ui.emergencyHold.hidden = !state.settings.emergencyEnabled || challenge.mode === "practice" || challenge.done;
  updateSnoozeLabel();
}

function coachText(sample) {
  if (!sample || !sample.tracking) {
    return "Step back until your shoulders, elbows, and hips are in the frame.";
  }
  let text;
  if (!sample.calibrated || sample.phase === "waiting") {
    text = "Hold the top of a pushup with your arms straight.";
  } else if (sample.phase === "down") {
    text = "Now push up until your arms are straight.";
  } else if (sample.phase === "rising") {
    text = "Lock your arms out at the top.";
  } else if (sample.phase === "lowering") {
    text = sample.elbowsBent
      ? "Lower your shoulders. Waving your arms does not count."
      : "Go lower — bend both elbows all the way.";
  } else {
    text = "Go down into a full pushup.";
  }
  if (sample.arms === 1) text += " Keep both arms in frame if you can.";
  return text;
}

function finishChallenge() {
  if (!challenge || challenge.done) return;
  challenge.done = true;
  audio.stopAlarm();
  audio.success();
  if (navigator.vibrate) navigator.vibrate([30, 40, 80]);
  if (challenge.mode === "alarm" && challenge.alarmId) {
    const index = state.alarms.findIndex((alarm) => alarm.id === challenge.alarmId);
    if (index >= 0) state.alarms[index] = satisfyAlarm(state.alarms[index]);
  }
  state.session = null;
  persist();
  ui.donePanel.hidden = false;
  ui.soundGate.hidden = true;
  updateChallengeHud(null);
  document.title = "Pushup Alarm";
  const next = state.alarms.find((alarm) => owesPushups(alarm, Date.now()));
  if (next && challenge.mode === "alarm") {
    stopCamera();
    challenge = null;
    beginChallenge({ mode: "alarm", alarm: next, fromGesture: audio.isReady() });
    return;
  }
  doneTimer = setTimeout(() => {
    if (challenge?.done) leaveChallenge();
  }, 5000);
}

function onSnooze() {
  if (!challenge || challenge.mode !== "alarm" || challenge.done || !state.settings.allowSnooze) return;
  const index = state.alarms.findIndex((alarm) => alarm.id === challenge.alarmId);
  if (index < 0) return;
  state.alarms[index] = snoozeAlarm(state.alarms[index], Date.now(), state.settings.snoozeMinutes);
  state.session = null;
  persist();
  audio.stopAlarm();
  leaveChallenge();
  armed = true;
  renderAlarms();
  renderArm();
  tickClock();
}

function emergencyStop() {
  cancelAnimationFrame(holdRaf);
  ui.emergencyHold.style.setProperty("--p", "0");
  if (!state.settings.emergencyEnabled || !challenge || challenge.mode === "practice") return;
  if (challenge.mode === "alarm" && challenge.alarmId) {
    const index = state.alarms.findIndex((alarm) => alarm.id === challenge.alarmId);
    if (index >= 0) state.alarms[index] = satisfyAlarm(state.alarms[index]);
  }
  state.session = null;
  persist();
  audio.stopAlarm();
  leaveChallenge();
  ui.armStatus.textContent = "Emergency stop used. The alarm is off.";
}

function leaveChallenge() {
  clearTimeout(doneTimer);
  stopCamera();
  audio.stopAlarm();
  challenge = null;
  counter = null;
  ui.viewChallenge.hidden = true;
  ui.viewChallenge.classList.remove("is-ringing", "is-complete");
  ui.soundGate.hidden = true;
  ui.donePanel.hidden = true;
  document.body.classList.remove("in-challenge");
  ui.viewNight.inert = false;
  ui.viewSettings.inert = false;
  document.title = "Pushup Alarm";
  showNight();
  renderAlarms();
  renderArm();
  tickClock();
}

function stopCamera() {
  loopToken += 1;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  ui.camVideo.srcObject = null;
  const context = ui.camCanvas.getContext("2d");
  context?.clearRect(0, 0, ui.camCanvas.width, ui.camCanvas.height);
}

function syncSession() {
  if (!challenge || challenge.mode !== "alarm") {
    state.session = null;
  } else {
    state.session = {
      mode: "alarm",
      alarmId: challenge.alarmId,
      target: challenge.target,
      reps: counter?.reps ?? 0,
      occurrenceAt: challenge.occurrenceAt,
      label: challenge.label,
    };
  }
  persist();
}

function bindHold(button) {
  let active = false;
  const stop = () => {
    active = false;
    cancelAnimationFrame(holdRaf);
    button.style.setProperty("--p", "0");
  };
  button.addEventListener("pointerdown", (event) => {
    if (button.hidden) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    active = true;
    const started = performance.now();
    const frame = () => {
      if (!active) return;
      const progress = Math.min(1, (performance.now() - started) / 4000);
      button.style.setProperty("--p", String(progress));
      if (progress >= 1) {
        active = false;
        emergencyStop();
        return;
      }
      holdRaf = requestAnimationFrame(frame);
    };
    holdRaf = requestAnimationFrame(frame);
  });
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
}

function preloadModel() {
  if (!librariesReady()) return;
  ensureDetector().catch(() => {});
}

function ensureDetector() {
  if (detector) return Promise.resolve(detector);
  if (!detectorPromise) {
    detectorPromise = loadDetector((message) => {
      if (challenge && ui.camMessage && !stream) ui.camMessage.textContent = message;
    })
      .then((created) => {
        detector = created;
        return created;
      })
      .catch((error) => {
        detectorPromise = null;
        throw error;
      });
  }
  return detectorPromise;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // Site root is the directory above /js/, so this works at /pushup-alarm/ and at a local server root.
  const root = new URL("../", import.meta.url);
  navigator.serviceWorker.register(new URL("sw.js", root), { scope: root.href }).then((registration) => {
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker || !navigator.serviceWorker.controller) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") ui.updateBanner.hidden = false;
      });
    });
  }).catch(() => {});
}

if (typeof document !== "undefined") main();
