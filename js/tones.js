/** Alarm waveforms shared by the Web Audio scheduler and the HTML audio fallback. */

export function tonePlan(kind) {
  if (kind === "siren") return { type: "sweep", period: 0.7, on: 0.62, f0: 520, f1: 1420 };
  if (kind === "pierce") return { type: "beeps", period: 0.22, on: 0.14, freqs: [1480, 1046] };
  return { type: "beeps", period: 0.48, on: 0.3, freqs: [880, 659] };
}

export function sampleTone(kind, time) {
  const plan = tonePlan(kind);
  if (plan.type === "sweep") {
    const local = time % plan.period;
    if (local >= plan.on) return 0;
    const freq = plan.f0 + (plan.f1 - plan.f0) * (local / plan.period);
    return Math.sign(Math.sin(2 * Math.PI * freq * time)) || 0;
  }
  const local = time % plan.period;
  if (local >= plan.on) return 0;
  const step = Math.floor(time / plan.period) % plan.freqs.length;
  const freq = plan.freqs[step];
  return Math.sign(Math.sin(2 * Math.PI * freq * time)) || 0;
}

/** Float samples in [-1, 1]. The loop length is an integer number of pattern periods. */
export function renderTone(kind, seconds = 2, sampleRate = 22050) {
  const plan = tonePlan(kind);
  const loops = Math.max(1, Math.round(seconds / plan.period));
  const duration = loops * plan.period;
  const count = Math.floor(duration * sampleRate);
  const out = new Float32Array(count);
  const amplitude = 0.92;
  for (let i = 0; i < count; i += 1) out[i] = sampleTone(kind, i / sampleRate) * amplitude;
  return out;
}

export function peakAmplitude(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

export function encodeWav(samples, sampleRate) {
  const count = samples.length;
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, count * 2, true);
  let offset = 44;
  for (let i = 0; i < count; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}
