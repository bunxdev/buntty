import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const logDir = mkdtempSync(join(tmpdir(), 'buntty-browser-logs-'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = spawn(process.env.BUN_BINARY || 'bun', ['run', 'server.js'], {
  cwd: new URL('../scripts/', import.meta.url),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', BUNTTY_LOG_DIR: logDir }, stdio: ['ignore', 'pipe', 'pipe']
});
let browser, base;
try {
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    server.once('error', reject);
    server.stdout.on('data', data => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('buntty_name', '<img src=x onerror="window.nameInjected=true">'));
  await page.goto(base + '/browser');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Tienes el control');
  assert.equal(await page.locator('#users img').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.nameInjected)), false);
  const send = command => page.evaluate(async command => {
    const { sendInput } = await import('/public/js/control.js'); sendInput(command + '\r');
  }, command);
  await send("export BROWSER_PERSISTED=yes; printf 'scroll-%04d\\n' {1..2200}");
  const text = () => page.evaluate(async () => {
    const { getTerminal } = await import('/public/js/terminal.js');
    const buffer = getTerminal().buffer.active;
    return Array.from({ length: buffer.length }, (_, n) => buffer.getLine(n).translateToString(true)).join('\n');
  });
  for (let n = 0; n < 100 && !(await text()).includes('scroll-2200'); n++) await page.waitForTimeout(50);
  assert.ok((await text()).includes('scroll-0001'), 'scrollback preserves more than 1000 lines');
  await page.evaluate(async () => (await import('/public/js/terminal.js')).getTerminal().scrollToTop());
  assert.equal(await page.evaluate(async () => (await import('/public/js/terminal.js')).getTerminal().buffer.active.viewportY), 0);
  await page.evaluate(async () => (await import('/public/js/connection.js')).getSocket().close());
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Desconectado');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Tienes el control');
  for (let n = 0; n < 100 && !(await text()).includes('scroll-2200'); n++) await page.waitForTimeout(50);
  assert.equal((await text()).split('scroll-0001').length - 1, 1, 'reconnect does not duplicate history');
  await send("printf 'preserved=%s\\n' \"$BROWSER_PERSISTED\"");
  for (let n = 0; n < 100 && !(await text()).includes('preserved=yes'); n++) await page.waitForTimeout(50);
  assert.ok((await text()).includes('preserved=yes'));
  const observer = await context.newPage();
  await observer.goto(base + '/browser');
  await observer.waitForFunction(() => document.getElementById('status').textContent === 'Solo lectura');
  assert.equal(await observer.evaluate(async () => (await import('/public/js/terminal.js')).getTerminal().options.disableStdin), true);
  await observer.locator('#btnControl').click();
  await observer.waitForFunction(() => document.getElementById('status').textContent === 'Tienes el control');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Solo lectura');
  await observer.locator('#btnControl').click();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Tienes el control');
  await send('exit');
  await page.waitForFunction(() => document.getElementById('overlayMsg').textContent.includes('ha terminado'));
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(async () => (await import('/public/js/connection.js')).getSocket()), null);
  await page.locator('#btnArchive').click();
  await page.waitForFunction(() => document.getElementById('archiveContent').textContent.includes('scroll-0001'));
  assert.ok((await page.locator('#archiveContent').innerText()).includes('scroll-2200'));
  assert.equal(await page.locator('#archiveContent img').count(), 0);
  await page.locator('#archiveClose').click();
  assert.deepEqual(errors, []);
  console.log('PASS: literal names, 2200-line scrollback, automatic reconnect, no duplicate replay, shell state, observer mode, control handoff, intentional exit');
} catch (error) {
  console.error(await browser?.contexts()[0]?.pages()[0]?.evaluate(() => ({ status: document.getElementById('archiveStatus').textContent, files: document.getElementById('archiveFiles').innerText, text: document.getElementById('archiveContent').textContent.slice(0, 300) })));
  throw error;
} finally {
  if (base) {
    await fetch(base + '/api/take-control?session=/browser', { method: 'POST' }).catch(() => {});
    await fetch(base + '/api/input?session=/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'exit\r' }) }).catch(() => {});
  }
  await browser?.close();
  server.kill();
  rmSync(logDir, { recursive: true, force: true });
}
