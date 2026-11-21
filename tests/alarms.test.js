import assert from "node:assert/strict";
import test from "node:test";
import {
  alarmsDue,
  clampPushups,
  createAlarm,
  formatDays,
  markRinging,
  nextOccurrenceMs,
  normalizeAlarm,
  owesPushups,
  satisfyAlarm,
  snoozeAlarm,
  upcomingMs,
} from "../js/alarms.js";
import { loadState, saveState } from "../js/store.js";

function local(year, month, day, hour, minute, second = 0, ms = 0) {
  return new Date(year, month - 1, day, hour, minute, second, ms).getTime();
}

function weekday(target, hour, minute) {
  const when = new Date(2026, 5, 15, hour, minute, 0, 0);
  while (when.getDay() !== target) when.setDate(when.getDate() + 1);
  return when.getTime();
}

test("new alarms default to 10 pushups on weekdays", () => {
  const alarm = createAlarm({ time: "6:30" });
  assert.equal(alarm.time, "06:30");
  assert.equal(alarm.pushups, 10);
  assert.deepEqual(alarm.days, [1, 2, 3, 4, 5]);
  assert.equal(alarm.enabled, true);
  assert.equal(clampPushups(0), 1);
  assert.equal(clampPushups(999), 200);
  assert.equal(clampPushups("nope"), 10);
});

test("empty days mean once, and an invalid time is rejected", () => {
  const once = createAlarm({ time: "7:05", days: [] });
  assert.deepEqual(once.days, []);
  assert.equal(formatDays(once.days), "Once");
  assert.equal(formatDays([1, 2, 3, 4, 5]), "Weekdays");
  assert.equal(formatDays([0, 1, 2, 3, 4, 5, 6]), "Every day");
  assert.equal(normalizeAlarm({ time: "25:00" }), null);
  assert.equal(createAlarm({ time: "bad" }), null);
});

test("next occurrence is later today, otherwise the next matching morning", () => {
  const friday = new Date(weekday(5, 6, 0));
  const alarm = createAlarm({
    time: "06:30",
    days: [1, 2, 3, 4, 5],
    id: "week",
  });
  const morning = local(friday.getFullYear(), friday.getMonth() + 1, friday.getDate(), 6, 0);
  const today = nextOccurrenceMs(alarm, morning);
  assert.equal(new Date(today).getDay(), 5);
  assert.equal(new Date(today).getHours(), 6);
  assert.equal(new Date(today).getMinutes(), 30);

  const after = local(friday.getFullYear(), friday.getMonth() + 1, friday.getDate(), 7, 0);
  const next = nextOccurrenceMs(alarm, after);
  assert.equal(new Date(next).getDay(), 1);
  assert.ok(next > after);
});

test("a one-shot alarm does not repeat after it is satisfied", () => {
  const start = local(2026, 6, 16, 5, 0);
  const once = createAlarm({ time: "06:30", days: [], id: "once" });
  const first = nextOccurrenceMs(once, start);
  assert.equal(new Date(first).getDate(), 16);
  const done = satisfyAlarm({ ...once, openOccurrence: first });
  assert.equal(done.enabled, false);
  assert.equal(done.openOccurrence, null);
  assert.equal(nextOccurrenceMs(done, first), null);
  assert.equal(nextOccurrenceMs({ ...once, lastSatisfiedAt: first, enabled: true }, first), null);
});

test("crossing the alarm minute fires once, including after a timer gap", () => {
  const alarm = createAlarm({ id: "daily", time: "06:30", days: [0, 1, 2, 3, 4, 5, 6] });
  const before = local(2026, 6, 16, 6, 29, 0);
  const afterGap = local(2026, 6, 16, 6, 33, 0);
  const due = alarmsDue([alarm], before, afterGap);
  assert.equal(due.length, 1);
  assert.equal(due[0].kind, "scheduled");
  assert.equal(due[0].id, "daily");

  const ringing = markRinging(alarm, due[0].at);
  assert.equal(ringing.pushups, 10);
  assert.equal(alarmsDue([ringing], before, afterGap).length, 0);
  assert.equal(owesPushups(ringing, afterGap), true);

  const later = alarmsDue([alarm], afterGap, afterGap + 1000);
  assert.equal(later.length, 0);
});

test("disabled alarms and the wrong weekday do not fire", () => {
  const monday = new Date(weekday(1, 6, 0));
  const sundayOnly = createAlarm({
    id: "sun",
    time: "06:30",
    days: [0],
  });
  const start = local(monday.getFullYear(), monday.getMonth() + 1, monday.getDate(), 6, 0);
  const end = start + 60 * 60 * 1000;
  assert.equal(alarmsDue([sundayOnly], start, end).length, 0);
  const disabled = { ...createAlarm({ id: "off", time: "06:30", days: [0, 1, 2, 3, 4, 5, 6] }), enabled: false };
  assert.equal(alarmsDue([disabled], start, end).length, 0);
});

test("snooze keeps the pushup requirement and rings again only when it elapses", () => {
  const alarm = createAlarm({ id: "s", time: "06:30", days: [0, 1, 2, 3, 4, 5, 6], pushups: 12 });
  const at = local(2026, 6, 16, 6, 30);
  const ringing = markRinging(alarm, at);
  const now = at + 20 * 1000;
  const snoozed = snoozeAlarm(ringing, now, 5);
  assert.equal(snoozed.pushups, 12);
  assert.equal(snoozed.openOccurrence, at);
  assert.equal(snoozed.lastSatisfiedAt, null);
  assert.equal(snoozed.snoozeUntil, now + 5 * 60 * 1000);
  assert.equal(owesPushups(snoozed, now + 60 * 1000), false);
  assert.equal(alarmsDue([snoozed], now, now + 60 * 1000).length, 0);

  const elapsed = snoozed.snoozeUntil + 10;
  const again = alarmsDue([snoozed], snoozed.snoozeUntil - 1000, elapsed);
  assert.equal(again.length, 1);
  assert.equal(again[0].kind, "snooze");
  assert.equal(upcomingMs(snoozed, now), snoozed.snoozeUntil);

  const finished = satisfyAlarm(markRinging(snoozed, snoozed.snoozeUntil));
  assert.equal(finished.openOccurrence, null);
  assert.equal(finished.snoozeUntil, null);
  assert.equal(finished.lastSatisfiedAt, at);
  assert.equal(finished.pushups, 12);
  assert.equal(finished.enabled, true);
  const next = nextOccurrenceMs(finished, elapsed);
  assert.equal(new Date(next).getDate(), 17);
});

test("settings and alarms round-trip, and emergency stop stays off", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
  };
  const state = loadState(storage);
  assert.equal(state.settings.emergencyEnabled, false);
  assert.equal(state.settings.tone, "classic");
  state.alarms.push(createAlarm({ id: "keep", time: "05:45", label: "Gym", pushups: 15, days: [1, 3] }));
  state.settings.emergencyEnabled = true;
  state.settings.tone = "nope";
  state.session = { mode: "alarm", alarmId: "keep", target: 15, reps: 4, occurrenceAt: 10, label: "Gym" };
  saveState(state, storage);
  const loaded = loadState(storage);
  assert.equal(loaded.alarms.length, 1);
  assert.equal(loaded.alarms[0].label, "Gym");
  assert.equal(loaded.alarms[0].pushups, 15);
  assert.deepEqual(loaded.alarms[0].days, [1, 3]);
  assert.equal(loaded.settings.tone, "classic");
  assert.equal(loaded.settings.emergencyEnabled, true);
  assert.equal(loaded.session.reps, 4);
  assert.equal(loaded.session.target, 15);
});
