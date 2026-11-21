import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("the page, manifest, and service worker point at real files", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(refs.length > 5);
  for (const ref of refs) {
    if (/^(https?:|data:|#)/.test(ref)) continue;
    const file = ref.split("?")[0].replace(/^\.\//, "");
    assert.ok(fs.existsSync(file), `missing ${file}`);
  }

  const manifest = JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/pushup-alarm/");
  assert.equal(manifest.scope, "/pushup-alarm/");
  assert.equal(manifest.id, "/pushup-alarm/");
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith("/pushup-alarm/"), icon.src);
    const file = icon.src.slice("/pushup-alarm/".length);
    assert.ok(fs.existsSync(file), file);
    assert.match(icon.sizes, /^\d+x\d+$/);
  }

  const worker = fs.readFileSync("sw.js", "utf8");
  assert.match(worker, /new URL\("\.\/", self\.location\.href\)/);
  const app = fs.readFileSync("js/app.js", "utf8");
  assert.match(app, /new URL\("\.\.\/", import\.meta\.url\)/);
  for (const file of [
    "index.html",
    "manifest.webmanifest",
    "css/styles.css",
    "js/app.js",
    "models/movenet/model.json",
    "models/movenet/group1-shard1of2.bin",
    "vendor/tf.min.js",
    "icons/icon-512.png",
  ]) {
    assert.match(worker, new RegExp(file.replace(/[.]/g, "\\.")));
    assert.ok(fs.existsSync(file), file);
  }
});

test("the MoveNet model shards match the manifest", () => {
  const model = JSON.parse(fs.readFileSync("models/movenet/model.json", "utf8"));
  const bytes = { float32: 4, int32: 4, float16: 2, int8: 1, uint8: 1, bool: 1 };
  let expected = 0;
  const paths = [];
  for (const group of model.weightsManifest) {
    paths.push(...group.paths);
    for (const weight of group.weights) {
      const count = (weight.shape || [1]).reduce((product, dim) => product * dim, 1);
      const stored = weight.quantization?.dtype || weight.dtype;
      expected += count * bytes[stored];
    }
  }
  let actual = 0;
  for (const file of paths) {
    const full = `models/movenet/${file}`;
    assert.ok(fs.existsSync(full), full);
    actual += fs.statSync(full).size;
  }
  assert.equal(actual, expected);
  assert.ok(fs.statSync("vendor/tf.min.js").size > 500_000);
  assert.ok(fs.statSync("vendor/pose-detection.js").size > 50_000);
});

test("app modules import in node", async () => {
  await import("../js/app.js");
});
