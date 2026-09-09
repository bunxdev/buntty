import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import WebSocket from 'ws';

const results = { date: new Date().toISOString(), checks: [] };
const sockets = new Set();
const attachedClients = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fn()) return;
    await pause(25);
  }
  throw new Error(`Timeout: ${label}`);
}
function record(name, value) { results.checks.push({ name, value }); console.log(name, JSON.stringify(value)); }
async function connect(url, kind) {
  const ws = new WebSocket(url, kind === 'ttyd' ? ['tty'] : [], {
    origin: new URL(url).origin.replace(/^ws/, 'http')
  });
  sockets.add(ws);
  ws.binaryType = 'arraybuffer';
  const client = { ws, output: '', messages: [], ready: false };
  ws.addEventListener('message', event => {
    const data = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString();
    if (kind === 'buntty') {
      const msg = JSON.parse(data); client.messages.push(msg);
      if (msg.type === 'welcome') { client.id = msg.clientId; client.ready = true; }
      if (msg.type === 'output' || msg.type === 'history') client.output += msg.data;
    } else if (kind === 'wetty') {
      if (data.startsWith('0')) ws.send('40');
      if (data === '2') ws.send('3');
      if (data.startsWith('42')) {
        const [type, body] = JSON.parse(data.slice(2));
        if (type === 'login') client.ready = true;
        if (type === 'data') { client.output += body; ws.send('42' + JSON.stringify(['commit', body.length])); }
      }
    } else if (data[0] === '0') { client.output += data.slice(1); client.ready = true; }
  });
  ws.addEventListener('open', () => {
    if (kind === 'ttyd') ws.send(JSON.stringify({ AuthToken: '', columns: 80, rows: 24 }));
  });
  client.send = data => ws.send(kind === 'buntty' ? JSON.stringify({ type: 'input', data }) : kind === 'wetty' ? '42' + JSON.stringify(['input', data]) : '0' + data);
  client.json = msg => ws.send(JSON.stringify(msg));
  await until(() => client.ready, `connect ${kind}`);
  return client;
}
async function command(client, cmd, expected) {
  client.output = '';
  client.send(cmd + '\r');
  await until(() => client.output.includes(expected), expected);
}
async function close(client) {
  client.ws.close();
  await until(() => client.ws.readyState === 3, 'close');
  sockets.delete(client.ws);
}
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 10000 }).trim();
const session = `/comparison-${Date.now()}`;
const base = process.env.BUNTTY_URL || 'http://127.0.0.1:3001';
const sessionURL = `${base.replace(/^http/, 'ws')}/ws?session=${encodeURIComponent(session)}`;
try {
  for (const [name, url] of [['buntty', base], ['wetty', 'http://127.0.0.1:3002/'], ['ttyd', 'http://127.0.0.1:3003/']]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    record(`${name}: HTTP`, response.status);
  }
  const a = await connect(sessionURL + '&name=ProbeA', 'buntty');
  const b = await connect(sessionURL + '&name=ProbeB', 'buntty');
  await command(a, "export COMPARISON_VALUE=persisted; printf 'shared-%s\\n' ok", 'shared-ok');
  await until(() => b.output.includes('shared-ok'), 'shared output');
  record('buntty: two clients share output', true);
  b.send('export OBSERVER_WROTE=yes\r');
  await pause(150);
  await command(a, "printf 'observer=%s\\n' \"${OBSERVER_WROTE:-no}\"", 'observer=no');
  record('buntty: observer WS input blocked', true);
  const response = await fetch(`${base}/api/input?session=${encodeURIComponent(session)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: "printf 'api-%s\\n' bypass\r" })
  });
  assert.equal(response.status, 409);
  record('buntty: API cannot bypass human controller', true);
  assert.equal((await fetch(`${base}/api/take-control?session=${encodeURIComponent(session)}`, { method: 'POST' })).status, 200);
  assert.equal((await fetch(`${base}/api/input?session=${encodeURIComponent(session)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: "printf 'api-%s\\n' bypass\r" })
  })).status, 200);
  await until(() => a.output.includes('api-bypass'), 'API bypass');
  record('buntty: API writes after explicitly taking control', true);
  a.json({ type: 'take_control' });
  await until(() => a.messages.some(m => m.type === 'control_changed' && m.controllerId === a.id), 'return control');
  a.json({ type: 'resize', cols: 80, rows: 24 });
  await command(a, 'stty size', '24 80');
  b.json({ type: 'resize', cols: 101, rows: 37 });
  await command(a, 'stty size', '24 80');
  record('buntty: observer cannot resize PTY', true);
  b.json({ type: 'take_control' });
  await until(() => a.messages.some(m => m.type === 'control_changed' && m.controllerId === b.id), 'control handoff');
  await command(b, "printf 'handoff-%s\\n' ok", 'handoff-ok');
  record('buntty: control handoff', true);
  await close(a); await close(b);
  const c = await connect(sessionURL, 'buntty');
  await until(() => c.output.includes('shared-ok'), 'replay');
  record('buntty: history on reconnect', true);
  await command(c, "printf 'state=%s\\n' \"$COMPARISON_VALUE\"", 'state=persisted');
  record('buntty: shell survives all clients disconnecting', true);
  const isolated = await connect(sessionURL + '-isolated', 'buntty');
  await command(isolated, "printf 'isolated=%s\\n' \"${COMPARISON_VALUE:-yes}\"", 'isolated=yes');
  record('buntty: paths isolate shell variables', true);
  isolated.send('exit\r'); await close(isolated);
  c.send('exit\r'); await close(c);

  for (const [kind, url] of [['wetty', 'ws://127.0.0.1:3002/socket.io/?EIO=4&transport=websocket'], ['ttyd', 'ws://127.0.0.1:3003/ws']]) {
    const first = await connect(url, kind);
    await command(first, "export COMPARISON_VALUE=persisted; printf 'shell-%s\\n' ok", 'shell-ok');
    record(`${kind}: real PTY command`, true);
    if (kind === 'wetty') first.ws.send('42' + JSON.stringify(['resize', { cols: 101, rows: 37 }]));
    else first.ws.send('1' + JSON.stringify({ columns: 101, rows: 37 }));
    await command(first, 'stty size', '37 101');
    record(`${kind}: PTY resize`, true);
    const second = await connect(url, kind);
    await command(second, "printf 'second=%s\\n' \"${COMPARISON_VALUE:-fresh}\"", 'second=fresh');
    record(`${kind}: clients get separate shells by default`, true);
    await close(first); await close(second);
    const third = await connect(url, kind);
    await command(third, "printf 'reconnected=%s\\n' \"${COMPARISON_VALUE:-fresh}\"", 'reconnected=fresh');
    record(`${kind}: reconnect creates fresh shell by default`, true);
    await close(third);
  }
  const tmate = (...args) => docker('exec', 'buntty-testing-tmate', 'tmate', '-S', '/tmp/tmate.sock', ...args);
  if (tmate('display-message', '-pt', 'comparison', '#{pane_in_mode}') === '1') {
    tmate('send-keys', '-t', 'comparison', 'q');
  }
  tmate('send-keys', '-t', 'comparison', "export COMPARISON_VALUE=persisted; printf 'tmate-%s\\n' ok", 'Enter');
  await until(() => tmate('capture-pane', '-pt', 'comparison').includes('tmate-ok'), 'tmate output');
  record('tmate: detached shell command', true);
  tmate('new-window', '-d', '-t', 'comparison', '-n', 'probe');
  assert.equal(tmate('list-windows', '-t', 'comparison', '-F', '#{window_name}').split('\n').length, 2);
  tmate('kill-window', '-t', 'comparison:probe');
  record('tmate: multiple windows', true);
  const attach = () => {
    const proc = spawn('docker', ['exec', '-i', 'buntty-testing-tmate', 'script', '-q', '-c',
      'tmate -S /tmp/tmate.sock attach-session -t comparison', '/dev/null']);
    const client = { proc, output: '' };
    proc.stdout.on('data', data => { client.output += data.toString(); });
    attachedClients.add(proc);
    return client;
  };
  const one = attach(), two = attach();
  await until(() => tmate('list-clients', '-F', '#{client_pid}').split('\n').filter(Boolean).length === 2, 'two attached tmate clients');
  one.proc.stdin.write("printf 'tmate-shared-%s\\n' yes\r");
  await until(() => one.output.includes('tmate-shared-yes') && two.output.includes('tmate-shared-yes'), 'tmate shared output');
  record('tmate: two attached local clients share terminal', true);
  tmate('detach-client', '-a');
  for (const client of [one, two]) client.proc.stdin.end();
  tmate('send-keys', '-t', 'comparison', "printf 'state=%s\\n' \"$COMPARISON_VALUE\"", 'Enter');
  await until(() => tmate('capture-pane', '-pt', 'comparison').includes('state=persisted'), 'tmate state');
  record('tmate: detached shell state persists', true);
  record('tmate: remote relay/SSH/web sharing', 'NOT TESTED: container network disabled');
} catch (error) {
  results.error = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  // Only terminate sessions created by this probe, never the user session.
  for (const path of [session, session + '-isolated']) {
    await fetch(`${base}/api/take-control?session=${encodeURIComponent(path)}`, {
      method: 'POST', signal: AbortSignal.timeout(2000)
    }).catch(() => {});
    await fetch(`${base}/api/input?session=${encodeURIComponent(path)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'exit\r' }), signal: AbortSignal.timeout(2000)
    }).catch(() => {});
  }
  for (const ws of sockets) ws.close();
  for (const proc of attachedClients) proc.kill();
  await writeFile(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
}
