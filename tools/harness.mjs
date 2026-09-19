// tools/harness.mjs —— 用 Marionette 协议驱动真 Firefox 取数（在 Windows 侧 node.exe 下运行）
//
// 为什么搬进仓库：验证不该散在仓库外的临时目录里。契约断言（tools/probes/contract.js）
// 与 HMR 回归（tools/probes/p0-hmr.js）都靠它跑，`node tools/check.mjs --browser`
// 也是转手调它。
//
// 为什么是 Firefox + Marionette：CDP 只能驱动 Edge/Chromium，而无头 Chromium 里
// WebGL 是死的；Marionette 是 geckodriver 的原生协议，能 ExecuteScript ——
// 于是可以在真 Firefox 里读 computedStyle、读画布像素、调 __dshWallpaper 钩子。
//
// 用法（Windows 路径，node.exe）：
//   node.exe tools\harness.mjs eval <probe.js>  [--port 2828] [--url U] [--width W] [--height H]
//   node.exe tools\harness.mjs shot <out.png>   [--port 2828] [--url U] [--wait 1200]
//   node.exe tools\harness.mjs both <out.png> <probe.js> [...]
//
// probe.js 里写函数体，用 `return` 交回结果（JSON 可序列化）。probe 会先等
// window.__dshWallpaper 出现（最多 6 秒），所以不用自己 sleep。
// 契约（contract/ui-contract.json）会先注入到页面的 window.__warmContract ——
// 探针据此断言，于是"改设计"只需要改契约，不用改探针。

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const mode = argv[0];
function flag(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const PORT = Number(flag('port', '2828'));
const WAIT = Number(flag('wait', '1500'));
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--')));
const URL_ = flag('url', '');

class Marionette {
  constructor(port) {
    this.port = port;
    this.buf = Buffer.alloc(0);
    this.hello = null;
    this.framed = false;
    this.waiters = new Map();
    this.id = 0;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(this.port, '127.0.0.1');
      this.sock.setNoDelay(true);
      this.sock.on('connect', resolve);
      this.sock.on('error', reject);
      this.sock.on('close', () => {
        for (const w of this.waiters.values()) w.reject(new Error('连接被关闭'));
        this.waiters.clear();
      });
      this.sock.on('data', (d) => this._onData(d));
    });
  }
  _onData(d) {
    if (process.env.FF_DEBUG) console.error('[_ff][raw] ' + JSON.stringify(d.toString('utf8').slice(0, 300)));
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (!this.framed) {
        // 握手包带不带长度前缀各版本不同，两种都认
        const text = this.buf.toString('utf8');
        if (text.startsWith('{')) {
          let hello;
          try { hello = JSON.parse(text); } catch { return; }
          this.hello = hello;
          this.framed = true;
          this.buf = Buffer.alloc(0);
          continue;
        }
      }
      const sep = this.buf.indexOf(0x3a);
      if (sep <= 0) return;
      if (!/^\d+$/.test(this.buf.subarray(0, sep).toString('utf8'))) return;
      const len = parseInt(this.buf.subarray(0, sep).toString('utf8'), 10);
      if (this.buf.length < sep + 1 + len) return;
      const json = this.buf.subarray(sep + 1, sep + 1 + len).toString('utf8');
      this.buf = this.buf.subarray(sep + 1 + len);
      const msg = JSON.parse(json);
      if (Array.isArray(msg)) {
        this.framed = true;
        const w = this.waiters.get(msg[1]);
        if (w) { this.waiters.delete(msg[1]); w.resolve(msg); }
      } else {
        this.framed = true; // 无前缀的握手对象
        if (msg.marionetteProtocol || msg.applicationType) this.hello = msg;
      }
    }
  }
  send(name, params = {}) {
    const id = ++this.id;
    const body = Buffer.from(JSON.stringify([0, id, name, params]), 'utf8');
    const frame = Buffer.concat([Buffer.from(String(body.length) + ':', 'utf8'), body]);
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      this.sock.write(frame);
      setTimeout(() => {
        if (this.waiters.has(id)) { this.waiters.delete(id); reject(new Error(name + ' 超时')); }
      }, 30000);
    });
  }
  async cmd(name, params) {
    const [type, , error, result] = await this.send(name, params);
    if (type !== 1 || error) throw new Error(name + ' 失败: ' + JSON.stringify(error));
    return result;
  }
}

// probe 前置：等壁纸插件挂上钩子再动手，省得每个探针自己写轮询
const PRELUDE = `
  const __deadline = Date.now() + 6000;
  while (!window.__dshWallpaper && Date.now() < __deadline) {
    await new Promise(r => setTimeout(r, 100));
  }
`;

/** 契约：注进页面，让探针按数据断言（改设计只改 contract/ui-contract.json）。 */
function contractLiteral() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, '..', 'contract', 'ui-contract.json');
  try {
    return 'window.__warmContract = ' + JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) + ';\n';
  } catch (error) {
    return 'window.__warmContract = null;\n';
  }
}

async function main() {
  const m = new Marionette(PORT);
  const t0 = Date.now();
  await m.connect();
  while (!m.hello && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
  if (!m.hello) throw new Error('没收到 Marionette 握手包；残留缓冲=' + JSON.stringify(m.buf.toString('utf8').slice(0, 300)));
  console.log('[harness] 已连上 Firefox，协议 v' + m.hello.marionetteProtocol);
  await m.cmd('WebDriver:NewSession', { capabilities: {} });

  const W = flag('width', ''), H = flag('height', '');
  if (W || H) {
    await m.cmd('WebDriver:SetWindowRect', { width: Number(W || 1752), height: Number(H || 830) })
      .catch((e) => console.error('[harness] 设窗口尺寸失败: ' + e.message));
  }

  if (URL_) {
    await m.cmd('WebDriver:Navigate', { url: URL_ });
    await m.cmd('WebDriver:ExecuteScript', {
      script: 'return new Promise(r => { if (document.readyState === "complete") r(1); else window.addEventListener("load", () => r(1), {once:true}); });',
      args: [],
    });
    await new Promise((r) => setTimeout(r, WAIT));
  }

  if (mode === 'eval' || mode === 'both') {
    const file = mode === 'eval' ? positional[0] : positional[1];
    const body = fs.readFileSync(file, 'utf8');
    const res = await m.cmd('WebDriver:ExecuteScript', {
      script: contractLiteral() + 'return (async () => {' + PRELUDE + body + '})()',
      args: [],
    });
    console.log(typeof res.value === 'string' ? res.value : JSON.stringify(res.value, null, 2));
  }

  if (mode === 'shot' || mode === 'both') {
    const out = mode === 'shot' ? positional[0] : positional[0];
    const r = await m.cmd('WebDriver:TakeScreenshot', { full: false, hash: false });
    const b64 = typeof r.value === 'string' ? r.value : r.value.value;
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    console.log('[harness] 截图写入 ' + out + ' (' + fs.statSync(out).size + ' 字节)');
  }

  await m.cmd('WebDriver:DeleteSession', {}).catch(() => {});
  m.sock.end();
}

main().catch((e) => { console.error('[harness] 出错: ' + e.message); process.exit(1); });
