import assert from "node:assert/strict";
import test from "node:test";
import { encodeWav, peakAmplitude, renderTone } from "../js/tones.js";

test("alarm tones are loud, loopable, and encoded as WAV", () => {
  for (const kind of ["classic", "siren", "pierce"]) {
    const samples = renderTone(kind, 2, 22050);
    assert.ok(samples.length > 22050, kind);
    assert.ok(peakAmplitude(samples) >= 0.9, `${kind} peak ${peakAmplitude(samples)}`);
    let silent = 0;
    for (const sample of samples) if (sample === 0) silent += 1;
    assert.ok(silent > 100, `${kind} should have gaps so the loop is not a solid buzz`);
    const wav = encodeWav(samples, 22050);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
    assert.equal(wav.length, 44 + samples.length * 2);
  }
});
