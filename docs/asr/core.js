// Parakeet (NeMo CTC, ja) front-end + decoder. Mirrors sherpa-onnx / kaldi-native-fbank settings.
const SR = 16000, FL = 400, FS = 160, NFFT = 512, NMEL = 80, EPS = 1.1920929e-7;

const win = new Float32Array(FL);
for (let i = 0; i < FL; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FL);

function melS(f) { return f <= 1000 ? f * 3 / 200 : 15 + 14.545078505785561 * Math.log(f / 1000); }
function imelS(m) { return m <= 15 ? 200 / 3 * m : 1000 * Math.exp((m - 15) * 0.06875177742094911); }
const NB = NFFT / 2 + 1;
const mel = []; // [{start, w:Float32Array}]
{
  const lo = melS(0), hi = melS(8000), d = (hi - lo) / (NMEL + 1), bw = SR / NFFT;
  for (let b = 0; b < NMEL; b++) {
    const l = imelS(lo + b * d), c = imelS(lo + (b + 1) * d), r = imelS(lo + (b + 2) * d);
    let first = -1; const ws = [];
    for (let i = 0; i < NB; i++) {
      const hz = bw * i;
      if (hz > l && hz < r) {
        let w = hz <= c ? (hz - l) / (c - l) : (r - hz) / (r - c);
        w *= 2 / (r - l);
        if (first < 0) first = i;
        ws.push(w);
      }
    }
    mel.push({ start: first, w: Float32Array.from(ws) });
  }
}

// radix-2 FFT tables
const rev = new Uint16Array(NFFT), cosT = new Float64Array(NFFT / 2), sinT = new Float64Array(NFFT / 2);
{
  const bits = Math.log2(NFFT);
  for (let i = 0; i < NFFT; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < NFFT / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / NFFT); sinT[i] = -Math.sin(2 * Math.PI * i / NFFT); }
}
const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
function fftPower(frame, out) {
  for (let i = 0; i < NFFT; i++) { re[rev[i]] = frame[i]; im[rev[i]] = 0; }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1, step = NFFT / size;
    for (let s = 0; s < NFFT; s += size) for (let j = 0; j < half; j++) {
      const k = j * step, a = s + j, b = a + half;
      const tr = re[b] * cosT[k] - im[b] * sinT[k], ti = re[b] * sinT[k] + im[b] * cosT[k];
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  for (let i = 0; i < NB; i++) out[i] = re[i] * re[i] + im[i] * im[i];
}

// returns {data: Float32Array(80*T) laid out [80][T] (model wants 1x80xT), T}
export function features(x) {
  const n = x.length, T = Math.floor((n + FS / 2) / FS);
  const feat = new Float32Array(T * NMEL); // [T][80]
  const fr = new Float64Array(NFFT), pw = new Float64Array(NB);
  for (let m = 0; m < T; m++) {
    const st = m * FS + FS / 2 - FL / 2;
    for (let i = 0; i < FL; i++) {
      let k = st + i;
      while (k < 0 || k >= n) { if (k < 0) k = -k - 1; else k = 2 * n - 1 - k; }
      fr[i] = x[k];
    }
    for (let i = FL - 1; i > 0; i--) fr[i] -= 0.97 * fr[i - 1];
    fr[0] -= 0.97 * fr[0];
    for (let i = 0; i < FL; i++) fr[i] *= win[i];
    for (let i = FL; i < NFFT; i++) fr[i] = 0;
    fftPower(fr, pw);
    for (let b = 0; b < NMEL; b++) {
      const { start, w } = mel[b]; let s = 0;
      for (let j = 0; j < w.length; j++) s += w[j] * pw[start + j];
      feat[m * NMEL + b] = Math.log(Math.max(s, EPS));
    }
  }
  const out = new Float32Array(T * NMEL);
  for (let b = 0; b < NMEL; b++) {
    let mean = 0; for (let m = 0; m < T; m++) mean += feat[m * NMEL + b]; mean /= T;
    let v = 0; for (let m = 0; m < T; m++) { const d = feat[m * NMEL + b] - mean; v += d * d; } v /= T;
    const inv = 1 / (Math.sqrt(v) + 1e-5);
    for (let m = 0; m < T; m++) out[b * T + m] = (feat[m * NMEL + b] - mean) * inv;
  }
  return { data: out, T };
}

// greedy CTC with per-token time (sec). logp: Float32Array [U][V]
export function ctcGreedy(logp, U, V, tokens, blank, offsetSec) {
  const res = []; let prev = -1;
  for (let u = 0; u < U; u++) {
    let best = 0, bv = -Infinity; const o = u * V;
    for (let v = 0; v < V; v++) if (logp[o + v] > bv) { bv = logp[o + v]; best = v; }
    if (best !== blank && best !== prev) res.push({ t: offsetSec + u * 0.08, s: tokens[best] });
    prev = best;
  }
  return res;
}

export function parseTokens(txt) {
  const tok = [];
  for (const line of txt.split('\n')) {
    if (!line) continue;
    const i = Math.max(line.lastIndexOf(' '), line.lastIndexOf('\t'));
    tok[+line.slice(i + 1)] = line.slice(0, i);
  }
  return tok;
}

// energy VAD → speech regions split at pauses (≥ gapSec), long ones cut at quiet points. returns [{s,e}] in samples
export function chunks(x, gapSec = 0.4, maxSec = 12) {
  const hop = 160, nf = Math.floor(x.length / hop), e = new Float32Array(nf);
  for (let f = 0; f < nf; f++) { let s = 0; for (let i = 0; i < hop; i++) { const v = x[f * hop + i]; s += v * v; } e[f] = 10 * Math.log10(s / hop + 1e-10); }
  const sorted = Float32Array.from(e).sort();
  const noise = sorted[Math.floor(nf * 0.1)] || -60, peak = sorted[Math.floor(nf * 0.98)] || 0;
  const thr = Math.max(noise + 8, Math.min(noise + 15, peak - 30));
  const gapF = Math.round(gapSec * 100), pad = 15, maxF = maxSec * 100;
  const regs = []; let f = 0;
  while (f < nf) {
    if (e[f] <= thr) { f++; continue; }
    const s = f; let last = f;
    while (f < nf && f - last < gapF) { if (e[f] > thr) last = f; f++; }
    if (last - s >= 8) regs.push([Math.max(0, s - pad), Math.min(nf, last + pad)]);
  }
  const out = [];
  for (const [s, en] of regs) {
    let a = s;
    while (en - a > maxF) {
      const lo = a + Math.floor(maxF * 0.5); let best = a + maxF - 1;
      for (let k = lo; k < a + maxF; k++) if (e[k] < e[best]) best = k;
      out.push([a, best]); a = best;
    }
    out.push([a, en]);
  }
  return out.map(([a, b]) => ({ s: a * hop, e: Math.min(x.length, b * hop) }));
}

// one chunk's tokens → line(s); split only at sentence-final marks
export function chunkLines(toks, startSec) {
  const lines = []; let cur = null;
  for (const k of toks) {
    const text = k.s.replace(/▁/g, ' ');
    if (!cur) { cur = { start: lines.length ? k.t : startSec, text: '' }; lines.push(cur); }
    cur.text += text;
    if (/[。？?！!]$/.test(text)) cur = null;
  }
  const junk = t => /^(チャ|ラ|ラン|プ|ブ|ル|ッ)+$/.test(t.replace(/[\s、。?？]/g, ''));
  return lines.map(l => ({ start: l.start, text: l.text.trim() })).filter(l => l.text && !/^[。、?？!！\s]+$/.test(l.text) && !junk(l.text));
}


// ---- Kaldi-style fbank (icefall / ReazonSpeech zipformer): povey window, dc removal, kaldi mel 20–7600Hz, no normalization. returns [T][80]
const winP = new Float32Array(FL);
for (let i = 0; i < FL; i++) winP[i] = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FL - 1)), 0.85);
const melK = [];
{
  const mk = f => 1127 * Math.log(1 + f / 700);
  const lo = mk(20), hi = mk(7600), d = (hi - lo) / (NMEL + 1), bw = SR / NFFT;
  for (let b = 0; b < NMEL; b++) {
    const l = lo + b * d, c = lo + (b + 1) * d, r = lo + (b + 2) * d;
    let first = -1; const ws = [];
    for (let i = 0; i < NFFT / 2; i++) {
      const m = mk(bw * i);
      if (m > l && m < r) { if (first < 0) first = i; ws.push(m <= c ? (m - l) / (c - l) : (r - m) / (r - c)); }
    }
    melK.push({ start: first, w: Float32Array.from(ws) });
  }
}
export function featuresKaldi(x) {
  const n = x.length, T = Math.floor((n + FS / 2) / FS);
  const feat = new Float32Array(T * NMEL);
  const fr = new Float64Array(NFFT), pw = new Float64Array(NB);
  for (let m = 0; m < T; m++) {
    const st = m * FS + FS / 2 - FL / 2;
    let mean = 0;
    for (let i = 0; i < FL; i++) {
      let k = st + i;
      while (k < 0 || k >= n) { if (k < 0) k = -k - 1; else k = 2 * n - 1 - k; }
      fr[i] = x[k]; mean += fr[i];
    }
    mean /= FL; for (let i = 0; i < FL; i++) fr[i] -= mean;
    for (let i = FL - 1; i > 0; i--) fr[i] -= 0.97 * fr[i - 1];
    fr[0] -= 0.97 * fr[0];
    for (let i = 0; i < FL; i++) fr[i] *= winP[i];
    for (let i = FL; i < NFFT; i++) fr[i] = 0;
    fftPower(fr, pw);
    for (let b = 0; b < NMEL; b++) {
      const { start, w } = melK[b]; let s = 0;
      for (let j = 0; j < w.length; j++) s += w[j] * pw[start + j];
      feat[m * NMEL + b] = Math.log(Math.max(s, EPS));
    }
  }
  return { data: feat, T };
}

// transducer greedy search (max 1 symbol / frame, blank=0, unk treated as blank). enc: Float32Array [U][C]
export async function transducerGreedy(ort, dec, join, enc, U, C, tokens, offsetSec, unk) {
  const ctx = [0, 0];
  const runDec = async () => (await dec.run({ y: new ort.Tensor('int64', BigInt64Array.from(ctx.map(BigInt)), [1, 2]) })).decoder_out.data;
  let dout = await runDec();
  const res = [];
  for (let u = 0; u < U; u++) {
    const e = enc.subarray(u * C, (u + 1) * C);
    const lg = (await join.run({ encoder_out: new ort.Tensor('float32', e, [1, C]), decoder_out: new ort.Tensor('float32', dout, [1, C]) })).logit.data;
    let best = 0, bv = -Infinity;
    for (let v = 0; v < lg.length; v++) if (lg[v] > bv) { bv = lg[v]; best = v; }
    if (best !== 0 && best !== unk) {
      res.push({ t: offsetSec + u * 0.04, s: tokens[best] });
      ctx[0] = ctx[1]; ctx[1] = best;
      dout = await runDec();
    }
  }
  return res;
}

// tokens (with times) → lines, new line on a pause longer than gap sec
export function tokLines(toks, startSec, gap = 0.5) {
  const lines = []; let cur = null, last = -1;
  for (const k of toks) {
    const text = k.s.replace(/▁/g, ' ');
    if (!cur || k.t - last > gap) { cur = { start: cur ? k.t : startSec, text: '' }; lines.push(cur); }
    cur.text += text; last = k.t;
  }
  return lines.map(l => ({ start: l.start, text: l.text.trim() })).filter(l => l.text);
}

// merge pause-split chunks into decode windows (gap < joinSec, total ≤ maxSec); keep the sub-chunks for line breaks
export function windows(cs, joinSec = 1.0, maxSec = 10) {
  const out = [];
  for (const c of cs) {
    const w = out[out.length - 1];
    if (w && c.s - w.e < joinSec * 16000 && c.e - w.s <= maxSec * 16000) { w.e = c.e; w.parts.push(c); }
    else out.push({ s: c.s, e: c.e, parts: [c] });
  }
  return out;
}
// assign tokens of one window to its sub-chunks → one line per sub-chunk
export function partLines(toks, parts, lag = 0.12) {
  const txt = parts.map(() => '');
  for (const k of toks) {
    const t = (k.t - lag) * 16000; let i = 0;
    while (i + 1 < parts.length && parts[i + 1].s <= t) i++;
    txt[i] += k.s.replace(/▁/g, ' ');
  }
  return parts.map((p, i) => ({ start: p.s / 16000, text: txt[i].trim() })).filter(l => l.text);
}

export function fmt(t) { t = Math.floor(t); return `[${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}]`; }
