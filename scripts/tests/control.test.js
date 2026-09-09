import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { state } from "../modules/state.js";
import { destroySession } from "../modules/session.js";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionFolder } from '../modules/archive.js';

let server, base;
const logDir = mkdtempSync(join(tmpdir(), 'buntty-archive-test-'));
const sockets = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let n = 0; n < 200; n++) { if (check()) return; await delay(10); }
  throw new Error("Timed out waiting for terminal output");
}
beforeAll(async () => {
  process.env.BUNTTY_LOG_DIR = logDir;
  process.env.PORT = "0"; process.env.HOST = "127.0.0.1";
  process.chdir(new URL("..", import.meta.url).pathname);
  server = (await import("../server.js")).default;
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => {
  for (const socket of sockets) socket.close();
  sockets.clear();
  for (const id of [...state.sessions.keys()]) destroySession(id);
});
afterAll(() => { server?.stop(true); rmSync(logDir, { recursive: true, force: true }); });

async function client(path) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?session=${path}`);
  sockets.add(ws);
  const peer = { ws, output: "", id: null, send: message => ws.send(JSON.stringify(message)) };
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === "welcome") peer.id = message.clientId;
    if (message.type === "history" || message.type === "output") peer.output += message.data;
  };
  await until(() => peer.id !== null);
  return peer;
}
const post = (path, body, headers = {}) => fetch(base + path, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body)
});
async function command(peer, input, expected) {
  peer.output = ""; peer.send({ type: "input", data: input + "\r" });
  await until(() => peer.output.includes(expected));
}

test("only the controller can write or resize, and the API must claim control", async () => {
  const owner = await client("/control"), observer = await client("/control");
  owner.send({ type: "resize", cols: 90, rows: 30 });
  await command(owner, "stty size", "30 90");
  observer.send({ type: "resize", cols: 101, rows: 37 });
  observer.send({ type: "input", data: "export OBSERVER_WROTE=yes\r" });
  await delay(30);
  await command(owner, "stty size; printf 'observer=%s\\n' \"${OBSERVER_WROTE:-no}\"", "observer=no");
  expect(owner.output).toContain("30 90");
  expect((await post("/api/input?session=/control", { data: "echo bypass\r" })).status).toBe(409);
  expect((await post("/api/take-control?session=/control", {})).status).toBe(200);
  expect((await post("/api/input?session=/control", { data: "printf 'api-%s\\n' ok\r" })).status).toBe(200);
  await until(() => observer.output.includes("api-ok"));
  observer.send({ type: "take_control" });
  await until(() => state.sessions.get("/control").controllerId === observer.id);
  expect((await post("/api/input?session=/control", { data: "echo bypass\r" })).status).toBe(409);
  await command(observer, "printf 'human-%s\\n' ok", "human-ok");
});

test("invalid messages cannot become shell input or break PTY dimensions", async () => {
  const owner = await client("/invalid");
  owner.ws.send("export RAW_WROTE=yes\r");
  for (const data of [null, 42, {}, ["echo bad"], "x".repeat(65_537)]) {
    owner.send({ type: "input", data });
    expect((await post("/api/input?session=/invalid", { data })).status).toBe(400);
  }
  owner.send({ type: "resize", cols: 1.5, rows: "bad" });
  await command(owner, "stty size; printf 'raw=%s\\n' \"${RAW_WROTE:-no}\"", "raw=no");
  expect(owner.output).toContain("24 80");
});

test("a reconnect reuses the shell and replays history; paths stay separate", async () => {
  const first = await client("/reconnect");
  await command(first, "export PRESERVED=yes; printf 'history-%s\\n' marker", "history-marker");
  first.ws.close(); await until(() => first.ws.readyState === WebSocket.CLOSED);
  const second = await client("/reconnect");
  await until(() => second.output.includes("history-marker"));
  await command(second, "printf 'preserved=%s\\n' \"$PRESERVED\"", "preserved=yes");
  const other = await client("/other");
  await command(other, "printf 'separate=%s\\n' \"${PRESERVED:-yes}\"", "separate=yes");
});

test("foreign browser origins are rejected on API and WebSocket routes", async () => {
  expect((await post("/api/take-control", {}, { Origin: "https://foreign.example" })).status).toBe(403);
  expect((await fetch(base + "/ws", { headers: { Origin: "https://foreign.example" } })).status).toBe(403);
  expect((await fetch(base + "/ws")).status).toBe(400);
  expect((await fetch(base + "/api/status", { headers: { Origin: base } })).status).toBe(200);
});

test("UTF-8 split across PTY chunks is decoded without corruption", async () => {
  const owner = await client("/utf8");
  await command(owner, "printf '\\342'; sleep 0.1; printf '\\202\\254\\n'", "€");
  expect(owner.output).not.toContain("�");
});

test('23 executed prompt entries produce blocks of 10, 10 and 3 commands', async () => {
  const owner = await client('/23');
  for (let n = 1; n <= 23; n++) {
    await command(owner, `printf 'saved-%s\\n' ${n}`, `saved-${n}`);
  }
  const dir = join(logDir, '23');
  const blocks = () => readdirSync(dir).sort().map(file => readFileSync(join(dir, file), 'utf8').trim().split('\n').map(JSON.parse));
  await until(() => blocks().flat().filter(e => e.type === 'end').length === 23);
  expect(blocks().map(events => events.filter(e => e.type === 'command').length)).toEqual([10, 10, 3]);
  expect(blocks().flat().filter(e => e.type === 'command').map(e => e.command)).toEqual(
    Array.from({ length: 23 }, (_, n) => `printf 'saved-%s\\n' ${n + 1}`)
  );
  // An interactive program consuming Enter does not create shell command records.
  await command(owner, `printf 'ready-%s\\n' read; read -r answer; printf 'reply=%s\\n' "$answer"`, 'ready-read');
  owner.send({ type: 'input', data: 'hello\r' });
  await until(() => owner.output.includes('reply=hello'));
  await until(() => blocks().flat().filter(e => e.type === 'end').length === 24);
  expect(blocks().flat().filter(e => e.type === 'command').length).toBe(24);
  await command(owner, 'false', 'false');
  await until(() => blocks().flat().some(e => e.type === 'end' && e.code === 1));
  await command(owner, `printf 'previous=%s\\n' "$?"`, 'previous=1');
  destroySession('/23');
  const listing = await (await fetch(base + '/api/logs?session=/23')).json();
  expect(listing.files.length).toBe(3);
  const saved = await (await fetch(base + '/api/logs?session=/23&file=' + listing.files.at(-1))).json();
  expect(saved.records.some(e => e.type === 'output' && e.data.includes('saved-1'))).toBe(true);
  // Recreating a shell in the same session cannot overwrite earlier runs.
  await client('/23');
  expect(readdirSync(dir).length).toBe(4);
});

test('session folders are unambiguous and log paths cannot escape the archive', async () => {
  expect(sessionFolder('/')).toBe('0'); expect(sessionFolder('/1')).toBe('1');
  expect(sessionFolder('/0')).not.toBe('0');
  expect(sessionFolder('/a/b')).not.toBe(sessionFolder('/a_b'));
  expect(sessionFolder('/../../etc')).not.toContain('/');
  expect((await fetch(base + '/api/logs?session=/23&file=../server.js')).status).toBe(400);
});
