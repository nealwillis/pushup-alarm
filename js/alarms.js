/**
 * Alarm schedule math. Pure functions — no localStorage, no timers.
 * Times are local wall-clock "HH:MM". Days are JS getDay() values, 0 = Sunday.
 * An empty days list means "once": the next time that clock time occurs, then off.
 */

export function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return [hour, minute];
}

export function normalizeTime(value) {
  const parsed = parseTime(value);
  if (!parsed) return null;
  return `${String(parsed[0]).padStart(2, "0")}:${String(parsed[1]).padStart(2, "0")}`;
}

export function clampPushups(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 10;
  return Math.min(200, Math.max(1, number));
}

export function sanitizeDays(days) {
  if (!Array.isArray(days)) return [];
  const set = new Set();
  for (const day of days) {
    const number = Number(day);
    if (Number.isInteger(number) && number >= 0 && number <= 6) set.add(number);
  }
  return [...set].sort((a, b) => a - b);
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeAlarm(raw) {
  if (!raw || typeof raw !== "object") return null;
  const time = normalizeTime(raw.time);
  if (!time) return null;
  return {
    id: raw.id ? String(raw.id) : randomId(),
    time,
    days: sanitizeDays(raw.days),
    label: String(raw.label ?? "Alarm").trim().slice(0, 40) || "Alarm",
    pushups: clampPushups(raw.pushups ?? 10),
    enabled: raw.enabled !== false,
    lastSatisfiedAt: numberOrNull(raw.lastSatisfiedAt),
    openOccurrence: numberOrNull(raw.openOccurrence),
    snoozeUntil: numberOrNull(raw.snoozeUntil),
  };
}

export function createAlarm(partial = {}) {
  const days = partial.days == null ? [1, 2, 3, 4, 5] : partial.days;
  return normalizeAlarm({
    pushups: 10,
    label: "Alarm",
    enabled: true,
    ...partial,
    days,
  });
}

/**
 * Next local occurrence strictly after `afterMs`.
 * Repeating alarms look ahead a week. A one-shot looks ahead at most one day,
 * and never again after it has been satisfied.
 */
export function nextOccurrenceMs(alarm, afterMs) {
  const parsed = parseTime(alarm.time);
  if (!parsed || alarm.enabled === false) return null;
  if (alarm.days.length === 0 && alarm.lastSatisfiedAt != null) return null;
  const [hour, minute] = parsed;
  const floor = Math.max(afterMs, alarm.lastSatisfiedAt ?? Number.NEGATIVE_INFINITY);
  const start = new Date(floor);
  const limit = alarm.days.length === 0 ? 2 : 8;
  for (let offset = 0; offset < limit; offset += 1) {
    const when = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, hour, minute, 0, 0);
    const ms = when.getTime();
    if (ms <= floor) continue;
    if (alarm.days.length === 0 || alarm.days.includes(when.getDay())) return ms;
  }
  return null;
}

/** When this alarm will next make noise, including a pending snooze. */
export function upcomingMs(alarm, nowMs) {
  if (!alarm.enabled && !alarm.openOccurrence) return null;
  if (alarm.snoozeUntil != null && alarm.snoozeUntil > nowMs) return alarm.snoozeUntil;
  if (alarm.enabled === false) return null;
  return nextOccurrenceMs(alarm, nowMs);
}

export function soonestAlarm(alarms, nowMs) {
  let best = null;
  for (const alarm of alarms) {
    const at = upcomingMs(alarm, nowMs);
    if (at == null) continue;
    if (!best || at < best.at) best = { alarm, at };
  }
  return best;
}

/**
 * True when this alarm still owes a set of pushups right now
 * (ringing, or a snooze that has already elapsed).
 */
export function owesPushups(alarm, nowMs) {
  if (!alarm?.openOccurrence) return false;
  if (alarm.snoozeUntil != null && alarm.snoozeUntil > nowMs) return false;
  return true;
}

/**
 * Alarms whose fire time was crossed while moving from prevMs (exclusive)
 * to nowMs (inclusive). An alarm that already owes pushups does not schedule
 * a second ring unless its snooze elapses in this window.
 */
export function alarmsDue(alarms, prevMs, nowMs) {
  const due = [];
  for (const alarm of alarms) {
    if (!alarm || alarm.enabled === false) continue;
    if (alarm.snoozeUntil != null && prevMs < alarm.snoozeUntil && nowMs >= alarm.snoozeUntil) {
      due.push({ id: alarm.id, kind: "snooze", at: alarm.snoozeUntil });
      continue;
    }
    if (alarm.snoozeUntil != null && nowMs < alarm.snoozeUntil) continue;
    if (alarm.openOccurrence) continue;
    const at = nextOccurrenceMs(alarm, prevMs);
    if (at != null && at > prevMs && at <= nowMs) {
      due.push({ id: alarm.id, kind: "scheduled", at });
    }
  }
  return due;
}

/** Mark an alarm as ringing. Pushups stay required. Snooze is consumed. */
export function markRinging(alarm, occurrenceAt) {
  return {
    ...alarm,
    openOccurrence: alarm.openOccurrence ?? occurrenceAt,
    snoozeUntil: null,
  };
}

/** Pause the noise. The pushup requirement and the original occurrence stay. */
export function snoozeAlarm(alarm, nowMs, minutes) {
  const duration = Math.min(60, Math.max(1, Math.round(Number(minutes) || 1)));
  return {
    ...alarm,
    snoozeUntil: nowMs + duration * 60 * 1000,
  };
}

/** The set was finished (or the emergency hold was used). One-shot alarms turn off. */
export function satisfyAlarm(alarm) {
  const at = alarm.openOccurrence ?? alarm.lastSatisfiedAt ?? Date.now();
  const next = {
    ...alarm,
    lastSatisfiedAt: at,
    openOccurrence: null,
    snoozeUntil: null,
  };
  if (next.days.length === 0) next.enabled = false;
  return next;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDays(days) {
  const clean = sanitizeDays(days);
  if (clean.length === 0) return "Once";
  if (clean.length === 7) return "Every day";
  if (clean.length === 5 && [1, 2, 3, 4, 5].every((day) => clean.includes(day))) return "Weekdays";
  if (clean.length === 2 && clean[0] === 0 && clean[1] === 6) return "Weekends";
  return clean.map((day) => DAY_NAMES[day]).join(" ");
}

export function formatClock(ms, locales) {
  return new Date(ms).toLocaleTimeString(locales, { hour: "numeric", minute: "2-digit" });
}

export function formatTimeOfDay(hhmm, locales) {
  const parsed = parseTime(hhmm);
  if (!parsed) return String(hhmm ?? "");
  const sample = new Date();
  sample.setHours(parsed[0], parsed[1], 0, 0);
  return sample.toLocaleTimeString(locales, { hour: "numeric", minute: "2-digit" });
}
