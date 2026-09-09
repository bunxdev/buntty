import { mkdirSync, openSync, writeSync, closeSync, readdirSync, readSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeSessionId } from './state.js';
import { stripVTControlCharacters } from 'node:util';

const FILE = /^\d{13}-[a-f0-9-]{36}-\d{6}\.jsonl$/;
export const logRoot = () => resolve(process.env.BUNTTY_LOG_DIR || new URL('../../logs/', import.meta.url).pathname);
export function sessionFolder(id) {
  id = normalizeSessionId(id);
  if (id === '/') return '0';
  if (/^\/[1-9]\d{0,30}$/.test(id)) return id.slice(1);
  return `session-${id.slice(1).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
}

export class Archive {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.dir = resolve(logRoot(), sessionFolder(sessionId));
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.run = `${Date.now()}-${randomUUID()}`;
    this.index = 0; this.count = 0; this.bytes = 0; this.command = 0; this.active = null;
    this.fd = null; this.rotate();
  }
  rotate() {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = openSync(resolve(this.dir, `${this.run}-${String(++this.index).padStart(6, '0')}.jsonl`), 'ax', 0o600);
    this.count = 0; this.bytes = 0;
    this.record({ type: 'block', session: this.sessionId, run: this.run, continuation: this.active });
  }
  record(event) {
    const line = Buffer.from(JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n');
    let written = 0;
    while (written < line.length) written += writeSync(this.fd, line, written, line.length - written);
    this.bytes += line.length;
  }
  start(command) {
    if (this.count >= 10 || this.bytes >= 1_048_576) this.rotate();
    this.active = ++this.command; this.count++;
    this.record({ type: 'command', id: this.active, command });
  }
  output(data) {
    // Bound each record, including output from a single very long-running command.
    for (let start = 0; start < data.length;) {
      let end = Math.min(start + 16_384, data.length);
      const last = data.charCodeAt(end - 1);
      if (end < data.length && last >= 0xD800 && last <= 0xDBFF) end--;
      if (this.bytes >= 1_048_576) this.rotate();
      this.record({ type: 'output', id: this.active, data: data.slice(start, end) });
      start = end;
    }
  }
  end(code) {
    if (this.active !== null) this.record({ type: 'end', id: this.active, code });
    this.active = null;
  }
  close() {
    if (this.fd === null) return;
    try { this.record({ type: 'closed', unfinishedCommand: this.active }); }
    finally { closeSync(this.fd); this.fd = null; }
  }
}

// Private shell markers are stripped before output is sent to the terminal.
export class CommandStream {
  constructor(token, output, start, end) {
    this.prefix = `\x1b]777;${token};`; this.pending = '';
    this.output = output; this.start = start; this.end = end;
  }
  push(data) {
    this.pending += data;
    while (this.pending) {
      const index = this.pending.indexOf(this.prefix);
      if (index < 0) {
        let keep = Math.min(this.pending.length, this.prefix.length - 1);
        while (keep && !this.prefix.startsWith(this.pending.slice(-keep))) keep--;
        this.output(this.pending.slice(0, this.pending.length - keep));
        this.pending = keep ? this.pending.slice(-keep) : '';
        return;
      }
      if (index) this.output(this.pending.slice(0, index));
      this.pending = this.pending.slice(index);
      const end = this.pending.indexOf('\x07', this.prefix.length);
      if (end < 0) {
        if (this.pending.length > 262_144) { this.output(this.pending); this.pending = ''; }
        return;
      }
      const marker = this.pending.slice(this.prefix.length, end);
      if (marker.startsWith('S;')) this.start(Buffer.from(marker.slice(2), 'base64').toString('utf8'));
      else if (/^E;\d+$/.test(marker)) this.end(Number(marker.slice(2)));
      this.pending = this.pending.slice(end + 1);
    }
  }
  flush() { if (this.pending) this.output(this.pending); this.pending = ''; }
}

export function handleLogs(url, sessionId) {
  const dir = resolve(logRoot(), sessionFolder(sessionId));
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const file = url.searchParams.get('file');
    if (!file) {
      const before = url.searchParams.get('before');
      const files = readdirSync(dir).filter(name => FILE.test(name) && (!before || name < before)).sort().reverse();
      return Response.json({ folder: sessionFolder(sessionId), files: files.slice(0, 30), next: files.length > 30 ? files[29] : null }, { headers });
    }
    if (!FILE.test(file)) return Response.json({ error: 'Invalid log file' }, { status: 400, headers });
    const offset = Number(url.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: 'Invalid offset' }, { status: 400, headers });
    const fd = openSync(resolve(dir, file), 'r');
    try {
      // Return complete JSONL records; the last partial record is retried later.
      const buffer = Buffer.alloc(262_144);
      const bytes = readSync(fd, buffer, 0, buffer.length, offset);
      const end = buffer.subarray(0, bytes).lastIndexOf(10) + 1;
      const records = end ? buffer.subarray(0, end).toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line)) : [];
      for (const record of records) if (record.type === 'output') record.text = stripVTControlCharacters(record.data);
      return Response.json({ file, records, offset: offset + end, more: offset + end < statSync(resolve(dir, file)).size }, { headers });
    } finally { closeSync(fd); }
  } catch (error) {
    if (error.code === 'ENOENT') return Response.json({ files: [], next: null, records: [], offset: 0, more: false }, { headers });
    console.error('[BunTTY] Reading logs failed:', error.message);
    return Response.json({ error: 'Cannot read session logs' }, { status: 500, headers });
  }
}
