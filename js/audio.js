import { encodeWav, renderTone, tonePlan } from "./tones.js";

/**
 * Alarm audio unlocked by a user gesture (required on iPadOS).
 * Web Audio schedules the loud loop. During the arming tap we also start a
 * silent HTML audio loop (keeps the iPad audio session alive overnight) and
 * a second element that already holds the alarm recording. Raising that
 * element's volume when the alarm fires does not need another tap.
 */

const SAMPLE_RATE = 22050;

export function createAlarmAudio() {
  let ctx = null;
  let master = null;
  let alarmGain = null;
  let keepalive = null;
  let timer = null;
  let nextBeep = 0;
  let activeKind = "classic";
  let mode = "idle";
  let loud = null;
  let silent = null;
  let urls = {};
  let generation = 0;

  function context() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    alarmGain = ctx.createGain();
    alarmGain.gain.value = 0;
    alarmGain.connect(master);
    ctx.addEventListener("statechange", () => {
      if (mode === "alarm" && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    });
    return ctx;
  }

  function wavUrl(kind) {
    if (urls[kind]) return urls[kind];
    const bytes = encodeWav(renderTone(kind, 2, SAMPLE_RATE), SAMPLE_RATE);
    const blob = new Blob([bytes], { type: "audio/wav" });
    urls[kind] = URL.createObjectURL(blob);
    return urls[kind];
  }

  function ensureElement(kind) {
    if (!loud) {
      loud = new Audio();
      loud.loop = true;
      loud.preload = "auto";
      loud.setAttribute("playsinline", "");
    }
    const url = wavUrl(kind);
    if (loud.getAttribute("data-kind") !== kind) {
      loud.src = url;
      loud.setAttribute("data-kind", kind);
    }
    return loud;
  }

  function startKeepalive(audioCtx) {
    if (keepalive) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.0008;
    osc.frequency.value = 28;
    osc.connect(gain).connect(master);
    osc.start();
    keepalive = osc;
  }

  function stopScheduler() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    nextBeep = 0;
    if (alarmGain && ctx) alarmGain.gain.setValueAtTime(0, ctx.currentTime);
  }

  function schedule(kind) {
    const audioCtx = context();
    if (!audioCtx) return;
    const plan = tonePlan(kind);
    const tick = () => {
      if (mode !== "alarm" || !ctx) return;
      const horizon = ctx.currentTime + 1.4;
      if (nextBeep < ctx.currentTime) nextBeep = ctx.currentTime + 0.05;
      while (nextBeep < horizon) {
        if (plan.type === "sweep") {
          beep(nextBeep, plan.on * 0.92, plan.f0, plan.f1);
        } else {
          const step = Math.round(nextBeep / plan.period) % plan.freqs.length;
          beep(nextBeep, plan.on * 0.92, plan.freqs[step], null);
        }
        nextBeep += plan.period;
      }
    };
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 200);
    tick();
  }

  function beep(time, duration, freq, endFreq) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, time);
    if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, time + duration);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.85, time + 0.02);
    gain.gain.setValueAtTime(0.85, time + Math.max(0.03, duration - 0.04));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain).connect(alarmGain);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  /** Call this synchronously inside a click/tap handler. */
  function unlock(kind = activeKind) {
    activeKind = kind || "classic";
    const audioCtx = context();
    if (audioCtx) {
      const buffer = audioCtx.createBuffer(1, 1, SAMPLE_RATE);
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(master);
      src.start(0);
      if (audioCtx.state !== "running") audioCtx.resume().catch(() => {});
      startKeepalive(audioCtx);
    }
    if (!silent) {
      const quiet = encodeWav(new Float32Array(SAMPLE_RATE), SAMPLE_RATE);
      silent = new Audio(URL.createObjectURL(new Blob([quiet], { type: "audio/wav" })));
      silent.loop = true;
      silent.volume = 1;
    }
    const kept = silent.play();
    if (kept?.catch) kept.catch(() => {});
    const element = ensureElement(activeKind);
    if (mode !== "alarm") element.volume = 0;
    const played = element.play();
    if (played?.catch) played.catch(() => {});
    if (mode !== "alarm") mode = "ready";
    return audioCtx;
  }

  function startAlarm(kind = activeKind) {
    generation += 1;
    activeKind = kind || "classic";
    mode = "alarm";
    unlock(activeKind);
    if (alarmGain && ctx) alarmGain.gain.setValueAtTime(0.95, ctx.currentTime);
    if (loud) {
      loud.volume = 1;
      const played = loud.play();
      if (played?.catch) played.catch(() => {});
    }
    schedule(activeKind);
  }

  function stopAlarm() {
    if (mode === "alarm") mode = ctx ? "ready" : "idle";
    stopScheduler();
    if (loud && mode !== "idle") loud.volume = 0;
  }

  function blip(frequency = 1320) {
    const audioCtx = context();
    if (!audioCtx || audioCtx.state !== "running") return;
    const time = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.8, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 0.1);
    if (mode === "alarm" && alarmGain) {
      alarmGain.gain.setTargetAtTime(0.22, time, 0.01);
      alarmGain.gain.setTargetAtTime(0.95, time + 0.12, 0.04);
    }
  }

  function success() {
    blip(523);
    setTimeout(() => blip(659), 120);
    setTimeout(() => blip(784), 240);
  }

  function preview(kind, ms = 1600) {
    if (mode === "alarm") return;
    startAlarm(kind);
    const gen = generation;
    setTimeout(() => {
      if (generation === gen) stopAlarm();
    }, ms);
  }

  function isReady() {
    return Boolean(ctx && ctx.state === "running");
  }

  return { unlock, startAlarm, stopAlarm, blip, success, preview, isReady, get mode() { return mode; } };
}
