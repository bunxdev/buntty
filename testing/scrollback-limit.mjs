import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const artifacts = new URL('./scrollback-results/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const report = { date: new Date().toISOString(), cases: [] };
const sessionId = `/scrollback-limit-${Date.now()}`;
const server = process.env.BUNTTY_URL ? null : spawn(process.env.BUN_BINARY || 'bun', ['run', 'server.js'], {
  cwd: new URL('../scripts/', import.meta.url),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHELL: '/bin/bash' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let browser, base, page;
try {
  base = process.env.BUNTTY_URL || await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000);
    server.once('error', reject);
    server.stdout.on('data', chunk => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  report.target = base; report.session = sessionId;
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1920, height: 900 }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + sessionId);
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Tienes el control');
  const send = cmd => page.evaluate(async cmd => {
    (await import('/public/js/control.js')).sendInput(cmd + '\r');
  }, cmd);
  const stats = prefix => page.evaluate(async prefix => {
    const term = (await import('/public/js/terminal.js')).getTerminal();
    await new Promise(resolve => term.write('', resolve));
    const buffer = term.buffer.active;
    const numbers = [];
    for (let i = 0; i < buffer.length; i++) {
      const match = buffer.getLine(i).translateToString(true).match(new RegExp('^' + prefix + '(\\d{6})(?:$|\\|)'));
      if (match) numbers.push(Number(match[1]));
    }
    return {
      cols: term.cols, rows: term.rows, scrollback: term.options.scrollback,
      bufferLength: buffer.length, baseY: buffer.baseY, viewportY: buffer.viewportY,
      numberedLines: numbers.length, first: numbers[0], last: numbers.at(-1),
      contiguous: numbers.every((value, i) => i === 0 || value === numbers[i - 1] + 1)
    };
  }, prefix);
  const waitLast = async (prefix, last) => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const ready = await page.evaluate(async ({ prefix, last }) => {
      const term = (await import('/public/js/terminal.js')).getTerminal();
      const buffer = term.buffer.active;
      for (let i = Math.max(0, buffer.length - 5); i < buffer.length; i++) {
        if (buffer.getLine(i).translateToString(true).startsWith(prefix + String(last).padStart(6, '0'))) return true;
      }
      return false;
      }, { prefix, last });
      if (ready) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`Timed out waiting for ${prefix}${last}`);
  };
  const record = (name, data, start) => {
    const result = { name, ...data, ...(start ? { elapsedMs: Math.round(performance.now() - start) } : {}) };
    report.cases.push(result); console.log(JSON.stringify(result));
  };
  const initial = await stats('L');
  assert.equal(initial.scrollback, 50000);
  assert.ok(initial.cols >= 158);
  let start = performance.now();
  // Disable echo and prompts, reset the screen, then emit numbered physical lines.
  await send("set +o emacs; set +o vi; stty -echo; PS1=''; printf '\\033c'; for ((i=1;i<=50000;i++)); do printf 'L%06d\\n' \"$i\"; done");
  await waitLast('L', 50000);
  let data = await stats('L');
  assert.equal(data.numberedLines, 50000); assert.equal(data.first, 1); assert.equal(data.last, 50000);
  assert.equal(data.contiguous, true);
  record('50000 short lines: all retained', data, start);

  const capacity = 50000 + data.rows;
  const exact = capacity - 1; // The final newline leaves one empty cursor row.
  await send(`for ((i=50001;i<=${exact};i++)); do printf 'L%06d\\n' "$i"; done`);
  await waitLast('L', exact);
  data = await stats('L');
  assert.equal(data.bufferLength, capacity); assert.equal(data.baseY, 50000);
  assert.equal(data.first, 1); assert.equal(data.numberedLines, exact);
  record('exact capacity: 50000 history rows plus screen', data);

  start = performance.now();
  await send(`for ((i=${exact + 1};i<=60000;i++)); do printf 'L%06d\\n' "$i"; done`);
  await waitLast('L', 60000);
  data = await stats('L');
  assert.equal(data.bufferLength, capacity); assert.equal(data.baseY, 50000);
  assert.equal(data.first, 60000 - capacity + 2); assert.equal(data.last, 60000);
  assert.equal(data.numberedLines, capacity - 1); assert.equal(data.contiguous, true);
  record('60000 short lines: oldest lines evicted at the exact boundary', data, start);
  const expectedFirst = data.first;
  await page.mouse.move(640, 450);
  await page.mouse.wheel(0, -2000000);
  await page.waitForTimeout(150);
  assert.equal((await stats('L')).viewportY, 0);
  assert.ok((await page.locator('.xterm-rows').innerText()).includes('L' + String(expectedFirst).padStart(6, '0')));
  await page.screenshot({ path: new URL('oldest-visible.png', artifacts).pathname });
  record('mouse wheel reaches oldest retained line, rendered at scroll top', { first: expectedFirst, viewportY: 0 });

  await page.mouse.wheel(0, 2000000);
  await page.waitForTimeout(150);
  assert.equal((await stats('L')).viewportY, 50000);
  await page.screenshot({ path: new URL('newest-visible.png', artifacts).pathname });

  start = performance.now();
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Tienes el control');
  await waitLast('L', 60000);
  data = await stats('L');
  assert.equal(data.first, expectedFirst); assert.equal(data.numberedLines, capacity - 1); assert.equal(data.contiguous, true);
  record('reload: short-line history restored at the same boundary', data, start);

  // 158 characters + CRLF per line: exactly 8,000,000 characters fit the replay buffer.
  start = performance.now();
  await send("printf '\\033c'; for ((i=1;i<=50000;i++)); do printf 'W%06d|%0150d\\n' \"$i\" 0; done");
  await waitLast('W', 50000);
  data = await stats('W');
  assert.equal(data.numberedLines, 50000); assert.equal(data.first, 1); assert.equal(data.contiguous, true);
  record('50000 lines of 158 characters: retained while connected', data, start);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Tienes el control');
  await waitLast('W', 50000);
  data = await stats('W');
  assert.equal(data.numberedLines, 50000); assert.equal(data.first, 1); assert.equal(data.last, 50000);
  assert.equal(data.contiguous, true);
  record('reload: 8000000-character server cap retains all 50000 wide lines', data);
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; process.exitCode = 1;
  console.error(error);
  await page?.screenshot({ path: new URL('failure.png', artifacts).pathname }).catch(() => {});
} finally {
  if (base) {
    await fetch(base + '/api/take-control?session=' + encodeURIComponent(sessionId), { method: 'POST' }).catch(() => {});
    await fetch(base + '/api/input?session=' + encodeURIComponent(sessionId), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'exit\r' })
    }).catch(() => {});
  }
  await browser?.close(); server?.kill();
  await writeFile(new URL('results.json', artifacts), JSON.stringify(report, null, 2) + '\n');
}
