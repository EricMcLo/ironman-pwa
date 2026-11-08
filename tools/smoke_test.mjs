#!/usr/bin/env node
/* ==========================================================================
   tools/smoke_test.mjs — click through the real app in a headless browser.

   Why: the app is plain static files with no build step, so nothing catches
   "I renamed a variable and the button silently stopped working" before it
   reaches the phone. This script boots the app in Chrome, clicks the things
   Eric and Ella actually click, and fails loudly if one of them breaks.

   Usage:
     node tools/smoke_test.mjs              # test the local files
     SMOKE_URL=https://... node tools/smoke_test.mjs   # test a deployed site

   Notes:
   - Uses a throwaway Chrome profile and blocks Turso, so it never touches
     real synced data.
   - Needs Google Chrome (or Chromium). Override with CHROME=/path/to/chrome.
   - Exit code 0 = all good, 1 = something failed, 2 = could not start.
   ========================================================================== */

import { spawn } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ tiny server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* --------------------------------------------------------------- chrome */

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/* ------------------------------------------- minimal DevTools client (CDP)
   Chrome speaks WebSocket. Node has no built-in client, so this is the
   smallest one that works: HTTP upgrade, then masked text frames. */

class CDP {
  constructor(wsUrl) {
    this.pending = new Map();
    this.nextId = 0;
    this.buffer = Buffer.alloc(0);
    this.upgraded = false;
    this.listeners = [];

    const u = new URL(wsUrl);
    this.socket = net.connect(Number(u.port), u.hostname, () => {
      const key = crypto.randomBytes(16).toString('base64');
      this.socket.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });

    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (!this.upgraded) {
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = this.buffer.subarray(0, end).toString();
        if (!head.includes('101')) throw new Error('WebSocket upgrade failed:\n' + head);
        this.buffer = this.buffer.subarray(end + 4);
        this.upgraded = true;
      }
      while (true) {
        const frame = this.readFrame();
        if (!frame) break;
        if (frame.opcode === 1) {
          let msg;
          try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { continue; }
          if (msg.id && this.pending.has(msg.id)) {
            this.pending.get(msg.id)(msg);
            this.pending.delete(msg.id);
          } else {
            this.listeners.forEach((fn) => fn(msg));
          }
        } else if (frame.opcode === 8) {
          this.socket.end();
          break;
        }
      }
    });
  }

  readFrame() {
    const b = this.buffer;
    if (b.length < 2) return null;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let pos = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      pos = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      len = Number(b.readBigUInt64BE(2));
      pos = 10;
    }
    if (masked) pos += 4;
    if (b.length < pos + len) return null;
    const payload = Buffer.from(b.subarray(pos, pos + len));
    if (masked) {
      const mask = b.subarray(pos - 4, pos);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    this.buffer = b.subarray(pos + len);
    return { opcode, payload };
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    const json = Buffer.from(JSON.stringify({ id, method, params }));
    let head;
    if (json.length < 126) {
      head = Buffer.from([0x81, 0x80 | json.length]);
    } else {
      const ext = Buffer.alloc(2);
      ext.writeUInt16BE(json.length);
      head = Buffer.concat([Buffer.from([0x81, 0x80 | 126]), ext]);
    }
    const mask = crypto.randomBytes(4);
    const body = Buffer.from(json);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([head, mask, body]));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  close() {
    try { this.socket.end(); } catch { /* already closed */ }
  }
}

async function connectToPage(port) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return new CDP(page.webSocketDebuggerUrl);
    } catch { /* chrome not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome never exposed a debuggable page');
}

/* --------------------------------------------------------------- runner */

const results = [];

function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      → ${detail}` : ''}`);
}

function note(text) {
  console.log(`\n— ${text}`);
}

/* ----------------------------------------------------------------- main */

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('Could not find Chrome. Set CHROME=/path/to/chrome and try again.');
    process.exit(2);
  }

  const useLocal = !process.env.SMOKE_URL;
  let server = null;
  let baseUrl = process.env.SMOKE_URL || '';

  if (useLocal) {
    const started = await startServer();
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}`;
  }

  const pageUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'view=week&athlete=eric&week=1';
  const port = 9500 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ironman-smoke-'));

  console.log(`Smoke test → ${pageUrl}`);
  console.log(`Chrome: ${chromePath}\n`);

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    pageUrl
  ], { stdio: 'ignore' });

  let cdp = null;
  const jsErrors = [];

  try {
    cdp = await connectToPage(port);
    await sleep(300);

    cdp.listeners.push((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        jsErrors.push((d.exception && d.exception.description) || d.text || 'unknown error');
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    if (useLocal) {
      // Keep the test offline from the sync DB so it starts from a blank slate
      // and can never overwrite Eric's or Ella's real data.
      await cdp.send('Network.enable');
      await cdp.send('Network.setBlockedURLs', { urls: ['*turso*', '*libsql*'] });
    }

    const ev = async (expression) => {
      const reply = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      const r = reply.result || {};
      if (r.exceptionDetails) {
        throw new Error(`Page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      }
      return r.result ? r.result.value : undefined;
    };

    const waitFor = async (expression, timeoutMs = 6000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          if (await ev(expression)) return true;
        } catch {
          // The page may be mid-navigation; try again.
        }
        await sleep(150);
      }
      return false;
    };

    const click = async (expression, settleMs = 500) => {
      await ev(expression);
      await sleep(settleMs);
    };

    const openBoard = async () => {
      await click(`[...document.querySelectorAll('#weekHead button')].find(b => b.textContent.trim() === 'Plan week').click()`, 600);
      return waitFor(`!document.getElementById('sheet').hidden`);
    };

    const closeSheet = async () => {
      await click(`document.getElementById('scrim').click()`, 350);
    };

    const waiting = () => ev(`parseInt(document.querySelector('.board-pool .board-pool-date').textContent, 10)`);
    const dayChips = () => ev(`[...document.querySelectorAll('.board-day')].map(d => d.querySelectorAll('.planner-chip').length)`);
    const totalChips = () => ev(`document.querySelectorAll('.board-pool .planner-chip').length + [...document.querySelectorAll('.board-day')].reduce((n, d) => n + d.querySelectorAll('.planner-chip').length, 0)`);

    /* ---------------------------------------------------------- boot */
    note('App boots');
    check('week view renders', await waitFor(`!!document.querySelector('#weekHead')`), 'no #weekHead');
    check('page title is the plan', (await ev(`document.title`)).includes('70.3'));
    check('Plan week button exists', await ev(`[...document.querySelectorAll('#weekHead button')].some(b => b.textContent.trim() === 'Plan week')`));

    /* --------------------------------------------------- week board */
    note('Week board opens');
    const opened = await openBoard();
    check('Plan week opens the sheet', opened, 'sheet stayed hidden');
    check('sheet is titled "Week board"', (await ev(`document.getElementById('sheetTitle').textContent`)) === 'Week board');
    check('seven day rows render', (await ev(`document.querySelectorAll('.board-day').length`)) === 7);
    check('workouts start in "To be assigned"', (await ev(`document.querySelectorAll('.board-pool .planner-chip').length`)) > 0);
    check('every pool chip has 7 day buttons', await ev(`[...document.querySelectorAll('.board-pool .planner-chip')].every(c => c.querySelectorAll('.chip-day').length === 7)`));

    /* reset to a known start: everything pooled */
    note('"Clear days" pools everything');
    await click(`[...document.querySelectorAll('.board-actions button')].find(b => /Clear days/.test(b.textContent)).click()`, 600);
    const pooledAll = await waiting();
    const chipsTotal = await totalChips();
    check('all workouts are waiting', pooledAll === chipsTotal, `waiting=${pooledAll} chips=${chipsTotal}`);
    check('all days are empty', (await dayChips()).every((n) => n === 0), JSON.stringify(await dayChips()));

    /* one-tap day letter */
    note('One-tap assign (day letter)');
    const firstTitle = await ev(`document.querySelector('.board-pool .planner-chip .planner-chip-title').textContent`);
    await click(`document.querySelector('.board-pool .planner-chip').querySelectorAll('.chip-day')[0].click()`, 550);
    check('waiting count drops by one', (await waiting()) === pooledAll - 1, `waiting=${await waiting()}`);
    check('Monday receives the workout', (await dayChips())[0] === 1, JSON.stringify(await dayChips()));
    check('the assigned workout left the pool', !(await ev(`[...document.querySelectorAll('.board-pool .planner-chip-title')].some(e => e.textContent === ${JSON.stringify(firstTitle)})`)));

    /* tap-tap fallback */
    note('Tap-tap assign');
    await click(`document.querySelector('.board-pool .planner-chip').click()`, 350);
    check('selecting a chip shows the hint', await ev(`!!document.querySelector('.board-hint')`));
    const beforeTapTap = await waiting();
    await click(`[...document.querySelectorAll('.board-day')][2].click()`, 550);
    check('tapping a day places the selected workout', (await dayChips())[2] === 1, JSON.stringify(await dayChips()));
    check('waiting count drops again', (await waiting()) === beforeTapTap - 1, `waiting=${await waiting()}`);

    /* chip back to pool */
    note('Tap a day chip to send it back');
    const beforeBack = await waiting();
    await click(`[...document.querySelectorAll('.board-day')][2].querySelector('.planner-chip').click()`, 550);
    check('Wednesday is empty again', (await dayChips())[2] === 0, JSON.stringify(await dayChips()));
    check('workout is waiting again', (await waiting()) === beforeBack + 1, `waiting=${await waiting()}`);

    /* use plan days */
    note('"Use plan days" restores the plan');
    await click(`[...document.querySelectorAll('.board-actions button')].find(b => /Use plan days/.test(b.textContent)).click()`, 650);
    check('nothing is waiting', (await waiting()) === 0, `waiting=${await waiting()}`);
    check('every workout is still on the board', (await totalChips()) === chipsTotal, `chips=${await totalChips()} expected=${chipsTotal}`);
    check('workouts are spread across days', (await dayChips()).filter((n) => n > 0).length >= 2, JSON.stringify(await dayChips()));

    await closeSheet();
    await openBoard();
    check('reopening does not re-pool the week', (await waiting()) === 0, `waiting=${await waiting()}`);
    await closeSheet();

    /* inline grip move */
    note('Inline ⠿ move');
    check('real workouts have a grip', (await ev(`document.querySelectorAll('.session .s-grip').length`)) >= 1);
    check('rest cards have no grip', await ev(`
      [...document.querySelectorAll('.session')]
        .filter(card => card.querySelector('.disc.rest'))
        .every(card => !card.querySelector('.s-grip'))
    `));

    await click(`document.querySelector('.session .s-grip').click()`, 450);
    const hintText = await ev(`document.querySelector('.move-hint')?.textContent || ''`);
    check('picking up a workout shows the hint', hintText.includes('picked up'), hintText || 'no hint');
    check('only one hint exists', (await ev(`document.querySelectorAll('.move-hint').length`)) === 1);

    /* force a re-render: expanding a card calls render() */
    await click(`document.querySelector('.session .session-main').click()`, 450);
    check('re-rendering does not duplicate the hint', (await ev(`document.querySelectorAll('.move-hint').length`)) === 1, `count=${await ev(`document.querySelectorAll('.move-hint').length`)}`);

    await click(`document.querySelector('.move-hint .board-hint-clear').click()`, 450);
    check('cancel clears the hint', (await ev(`document.querySelectorAll('.move-hint').length`)) === 0);

    /* athlete switch */
    note('Ella and Both views');
    await click(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ella' && b.offsetParent !== null).click()`, 800);
    check('Ella theme is applied', (await ev(`document.querySelector('.hero')?.className || ''`)).includes('who-ella'), await ev(`document.querySelector('.hero')?.className`));
    check('Ella board opens with 7 days', (await openBoard()) && (await ev(`document.querySelectorAll('.board-day').length`)) === 7);
    await closeSheet();

    await click(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Both' && b.offsetParent !== null).click()`, 800);
    check('Both view is applied', (await ev(`document.querySelector('.hero')?.className || ''`)).includes('who-both'), await ev(`document.querySelector('.hero')?.className`));
    check('Both board opens with 7 days', (await openBoard()) && (await ev(`document.querySelectorAll('.board-day').length`)) === 7);
    await closeSheet();

    /* ------------------------------------------------------- race names */
    /* The two goal races used to render as just "Race" because plan.json
       had no title on them. Keep them named. */
    note('Race days are named');
    const goToWeek = async (week) => {
      await cdp.send('Page.navigate', { url: `${baseUrl}?view=week&athlete=eric&week=${week}` });
      return waitFor(`document.querySelector('#weekHead h2')?.textContent.trim() === 'Week ${week}'`, 8000);
    };
    const raceTitle = () => ev(`
      document.querySelector('.session .disc.race')
        ?.closest('.session')
        ?.querySelector('.s-title')
        ?.textContent || null
    `);

    check('week 42 loads', await goToWeek(42));
    check('70.3 Utah race card is named', (await raceTitle()) === 'Ironman 70.3 Utah', String(await raceTitle()));

    check('week 51 loads', await goToWeek(51));
    check('CIM Marathon race card is named', (await raceTitle()) === 'CIM Marathon', String(await raceTitle()));

    /* --------------------------------------------------------- wrap up */
    check('no uncaught JavaScript errors', jsErrors.length === 0, jsErrors.join('\n      '));
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    if (server) server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/* ------------------------------------------------------------------ exit */

let failed = 0;
try {
  await main();
} catch (err) {
  console.error(`\nSmoke test could not finish: ${err.message}`);
  failed = 1;
}

const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed}/${total} checks passed`);

if (!failed && passed !== total) failed = 1;
process.exit(failed ? 1 : 0);
