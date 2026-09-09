import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'buntty-80m-'));
const report = { date: new Date().toISOString(), requestedCharacters: 80_000_000, rowsGenerated: 500_000, lineCharacters: 158 };
const server = spawn(process.env.BUN_BINARY || 'bun', ['run', 'server.js'], {
  cwd: new URL('../scripts/', import.meta.url),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHELL: '/bin/bash', BUNTTY_LOG_DIR: dir, BUNTTY_HISTORY_CHARS: '80000000' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let browser, page, base, peakRssKiB = 0;
const sampling = setInterval(() => {
  try { peakRssKiB = Math.max(peakRssKiB, Number(readFileSync(`/proc/${server.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] || 0)); } catch {}
}, 250);
try {
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    server.once('error', reject);
    server.stdout.on('data', data => { const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1920, height: 900 }, ignoreHTTPSErrors: true });
  await page.addInitScript(() => {
    window.stress = { connections: 0, closes: 0, histories: [] };
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args); window.stress.connections++;
        this.addEventListener('close', () => window.stress.closes++);
        this.addEventListener('message', event => {
          const message = JSON.parse(event.data);
          if (message.type !== 'history') return;
          const result = { characters: message.data.length, lines: 0, contiguous: true, first: null, last: null };
          for (const match of message.data.matchAll(/W(\d{6})\|0{150}\r\n/g)) {
            const n = Number(match[1]);
            if (result.last !== null && n !== result.last + 1) result.contiguous = false;
            if (result.first === null) result.first = n;
            result.last = n; result.lines++;
          }
          window.stress.histories.push(result);
        });
      }
    };
  });
  await page.goto(base + '/stress-80m');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Tienes el control');
  const started = performance.now();
  await page.evaluate(async () => {
    (await import('/public/js/control.js')).sendInput("set +o emacs; set +o vi; stty -echo; PS1=''; printf '\\033c'; awk 'BEGIN {for(i=1;i<=500000;i++) printf \"W%06d|%0150d\\n\", i, 0}'\r");
  });
  async function waitForLast(timeout) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const ready = await page.evaluate(async () => {
        const term = (await import('/public/js/terminal.js')).getTerminal();
        for (let i = Math.max(0, term.buffer.active.length - 5); i < term.buffer.active.length; i++) {
          if (term.buffer.active.getLine(i).translateToString(true).startsWith('W500000|')) return true;
        }
        return false;
      });
      if (ready) return;
      await page.waitForTimeout(100);
    }
    throw new Error('The terminal did not render the last line within the timeout');
  }
  await waitForLast(180000);
  report.liveGenerationMs = Math.round(performance.now() - started);
  report.live = await page.evaluate(() => window.stress);
  console.log('Live generation complete', JSON.stringify(report.live));
  const reloadStarted = performance.now();
  await page.reload();
  await page.waitForFunction(() => window.stress.histories.some(h => h.characters === 80000000), null, { timeout: 45000 });
  await waitForLast(45000);
  report.reloadMs = Math.round(performance.now() - reloadStarted);
  report.reload = await page.evaluate(() => window.stress);
  const replay = report.reload.histories.find(h => h.characters === 80000000);
  assert.equal(replay.lines, 500000); assert.equal(replay.first, 1); assert.equal(replay.last, 500000); assert.equal(replay.contiguous, true);
  report.visibleBuffer = await page.evaluate(async () => {
    const term = (await import('/public/js/terminal.js')).getTerminal();
    return { length: term.buffer.active.length, rows: term.rows, first: term.buffer.active.getLine(0).translateToString(true), scrollback: term.options.scrollback };
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.message;
  report.browserState = await page?.evaluate(() => ({ ...window.stress, status: document.getElementById('status')?.textContent })).catch(() => null);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearInterval(sampling); report.peakServerRssMiB = Math.round(peakRssKiB / 1024);
  if (base) {
    await fetch(base + '/api/take-control?session=/stress-80m', { method: 'POST' }).catch(() => {});
    await fetch(base + '/api/input?session=/stress-80m', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: '\x03exit\r' }) }).catch(() => {});
  }
  await browser?.close(); server.kill();
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(new URL('./stress-80m-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
