# 同梱しているもののライセンス

このリポジトリ自身のコード（`src/`・`test/`・`docs/index.html`・`docs/asr/worker.js`・`docs/asr/core.js`）は MIT ライセンス（`LICENSE`）。
次のものは、それぞれのライセンスのまま同梱している。

## 文字起こしモデル — `docs/asr/zf/*.wasm`、`docs/asr/tokens.txt`
- ReazonSpeech k2 v2（日本語音声認識モデル）。開発：Reazon Holdings / reazon-research
- ONNX 形式・int8 への変換：k2-fsa / sherpa-onnx（`sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01`）
- ライセンス：Apache License 2.0（全文は `LICENSE-APACHE-2.0.txt`）
- 変更点：ブラウザで配信するため、encoder（`encoder-epoch-99-avg-1.int8.onnx`）を 19MiB ずつ8つに分割し、拡張子を `.wasm` にしている。中身は無変更（つなげると元のファイルに戻る）。decoder・joiner も拡張子だけ `.wasm` に変えている。

## 推論エンジン — `docs/asr/ort.js`、`docs/asr/ort-wasm.js`、`docs/asr/ort-wasm.wasm`
- ONNX Runtime Web（onnxruntime-web）。ファイル名だけ変えている。
- ライセンス：MIT License

```
MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
