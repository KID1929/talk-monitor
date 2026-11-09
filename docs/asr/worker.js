// トークモニター 録音→文字起こし ワーカー
// ReazonSpeech k2 v2（日本語 zipformer transducer, int8）を onnxruntime-web でブラウザ内実行。録音は外に出ない。
import * as ort from './ort.js';
import { featuresKaldi, transducerGreedy, parseTokens, chunks } from './core.js';

const BASE = new URL('./', import.meta.url).href;
const VER = 'reazon-k2v2-int8-v1', ENC_PARTS = 8, PAD = 8000; // 0.5秒の無音を前後に足す
ort.env.wasm.wasmPaths = { mjs: BASE + 'ort-wasm.js', wasm: BASE + 'ort-wasm.wasm' };
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

let enc = null, dec = null, join = null, tokens = null, unk = -1;
const post = (m) => self.postMessage(m);

function idb() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('tm-asr', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('parts');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
function idbGet(db, k) {
  return new Promise((res) => {
    if (!db) return res(null);
    try { const q = db.transaction('parts').objectStore('parts').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }
    catch (e) { res(null); }
  });
}
function idbPut(db, k, v) {
  return new Promise((res) => {
    if (!db) return res(false);
    try { const t = db.transaction('parts', 'readwrite'); t.objectStore('parts').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); t.onabort = () => res(false); }
    catch (e) { res(false); }
  });
}

async function load() {
  if (enc) return;
  const db = await idb();
  tokens = parseTokens(await (await fetch(BASE + 'tokens.txt')).text());
  unk = tokens.indexOf('<unk>');
  const files = [];
  for (let i = 0; i < ENC_PARTS; i++) files.push('zf/e' + String(i).padStart(2, '0') + '.wasm');
  files.push('zf/decoder.wasm', 'zf/joiner.wasm');
  const bufs = []; let cached = 0;
  for (let i = 0; i < files.length; i++) {
    const key = VER + '/' + files[i];
    let ab = await idbGet(db, key);
    if (ab) cached++;
    else {
      const r = await fetch(BASE + files[i]);
      if (!r.ok) throw new Error('モデルの読み込みに失敗（' + r.status + '）');
      ab = await r.arrayBuffer();
      await idbPut(db, key, ab);
    }
    bufs.push(ab);
    post({ type: 'progress', phase: 'load', done: i + 1, total: files.length, cached });
  }
  const encBufs = bufs.slice(0, ENC_PARTS);
  const total = encBufs.reduce((a, b) => a + b.byteLength, 0);
  const all = new Uint8Array(total); let o = 0;
  for (const b of encBufs) { all.set(new Uint8Array(b), o); o += b.byteLength; }
  post({ type: 'progress', phase: 'init' });
  const opt = { executionProviders: ['wasm'] };
  enc = await ort.InferenceSession.create(all, opt);
  dec = await ort.InferenceSession.create(new Uint8Array(bufs[ENC_PARTS]), opt);
  join = await ort.InferenceSession.create(new Uint8Array(bufs[ENC_PARTS + 1]), opt);
}

async function transcribe(x, onChunk) {
  const cs = chunks(x, 0.4, 12), lines = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const seg = new Float32Array(c.e - c.s + 2 * PAD);
    seg.set(x.subarray(c.s, c.e), PAD);
    const { data, T } = featuresKaldi(seg);
    const r = await enc.run({
      x: new ort.Tensor('float32', data, [1, T, 80]),
      x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]),
    });
    const eo = r.encoder_out;
    const tk = await transducerGreedy(ort, dec, join, eo.data, eo.dims[1], eo.dims[2], tokens, 0, unk);
    const text = tk.map((t) => t.s).join('').replace(/▁/g, ' ').trim();
    if (text) lines.push({ start: c.s / 16000, text });
    onChunk(i + 1, cs.length);
  }
  return lines;
}

self.onmessage = async (ev) => {
  const { channels } = ev.data;
  try {
    const t0 = Date.now();
    await load();
    const out = [];
    const totalSec = channels.reduce((a, c) => a + c.length / 16000, 0);
    let doneSec = 0;
    for (let ch = 0; ch < channels.length; ch++) {
      const x = channels[ch];
      const lines = await transcribe(x, (d, n) => {
        post({ type: 'progress', phase: 'asr', frac: (doneSec + (x.length / 16000) * d / n) / totalSec });
      });
      doneSec += x.length / 16000;
      lines.forEach((l) => { l.ch = ch; out.push(l); });
    }
    out.sort((a, b) => a.start - b.start);
    post({ type: 'done', lines: out, ms: Date.now() - t0 });
  } catch (e) {
    post({ type: 'error', message: String(e && e.message || e) });
  }
};
post({ type: 'ready' });
