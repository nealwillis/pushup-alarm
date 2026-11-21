import { normalizeAlarm } from "./alarms.js";

const KEY = "pushup-alarm.v1";

export function defaultSettings() {
  return {
    snoozeMinutes: 5,
    allowSnooze: true,
    dim: 0.35,
    tone: "classic",
    emergencyEnabled: false,
    installHintDismissed: false,
  };
}

export function defaultState() {
  return { alarms: [], settings: defaultSettings(), session: null };
}

function normalizeSettings(raw) {
  const settings = { ...defaultSettings(), ...(raw && typeof raw === "object" ? raw : {}) };
  const tone = settings.tone;
  settings.tone = tone === "siren" || tone === "pierce" ? tone : "classic";
  const dim = Number(settings.dim);
  settings.dim = Number.isFinite(dim) ? Math.min(0.75, Math.max(0, dim)) : 0.35;
  const snooze = Math.round(Number(settings.snoozeMinutes));
  settings.snoozeMinutes = [1, 5, 10].includes(snooze) ? snooze : 5;
  settings.allowSnooze = settings.allowSnooze !== false;
  settings.emergencyEnabled = settings.emergencyEnabled === true;
  settings.installHintDismissed = settings.installHintDismissed === true;
  return settings;
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.mode !== "alarm" && raw.mode !== "test" && raw.mode !== "practice") return null;
  const target = Math.round(Number(raw.target));
  const reps = Math.round(Number(raw.reps));
  if (!Number.isFinite(target) || target < 1) return null;
  if (Number.isFinite(reps) && reps >= target) return null;
  return {
    mode: raw.mode,
    alarmId: raw.alarmId ? String(raw.alarmId) : null,
    target,
    reps: Number.isFinite(reps) && reps > 0 ? reps : 0,
    occurrenceAt: Number.isFinite(Number(raw.occurrenceAt)) ? Number(raw.occurrenceAt) : null,
    label: String(raw.label || "Alarm").slice(0, 40),
  };
}

export function loadState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    const alarms = Array.isArray(data.alarms) ? data.alarms.map(normalizeAlarm).filter(Boolean) : [];
    return {
      alarms,
      settings: normalizeSettings(data.settings),
      session: normalizeSession(data.session),
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  storage.setItem(
    KEY,
    JSON.stringify({
      alarms: state.alarms,
      settings: state.settings,
      session: state.session ?? null,
    }),
  );
}
