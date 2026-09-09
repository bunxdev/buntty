import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Archive, CommandStream, handleLogs } from '../modules/archive.js';

test('fragmented command markers are stripped without losing Unicode output', () => {
  const output = [], commands = [], ends = [];
  const stream = new CommandStream('token', data => output.push(data), command => commands.push(command), code => ends.push(code));
  const value = `before\x1b]777;token;S;${Buffer.from('echo hola').toString('base64')}\x07héllo\x1b]777;token;E;0\x07after`;
  for (const character of value) stream.push(character);
  stream.flush();
  expect(output.join('')).toBe('beforehélloafter'); expect(commands).toEqual(['echo hola']); expect(ends).toEqual([0]);
});

test('large output rotates with continuation metadata and can be read in bounded pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'buntty-output-'));
  const prior = process.env.BUNTTY_LOG_DIR;
  process.env.BUNTTY_LOG_DIR = dir;
  try {
    const archive = new Archive('/');
    archive.start('large command');
    const original = 'x\x1b[31m€😀\n'.repeat(200_000);
    archive.output(original); archive.end(0); archive.close();
    const files = readdirSync(join(dir, '0')).sort();
    expect(files.length).toBeGreaterThan(1);
    let recovered = '', commands = 0;
    for (const file of files) {
      expect(statSync(join(dir, '0', file)).size).toBeLessThan(1_200_000);
      let offset = 0, more;
      do {
        const response = await handleLogs(new URL(`http://x/api/logs?file=${file}&offset=${offset}`), '/').json();
        for (const event of response.records) {
          if (event.type === 'command') commands++;
          if (event.type === 'output') recovered += event.data;
        }
        expect(response.offset).toBeGreaterThan(offset);
        offset = response.offset; more = response.more;
      } while (more);
    }
    expect(recovered).toBe(original); expect(commands).toBe(1);
    const next = JSON.parse(readFileSync(join(dir, '0', files[1]), 'utf8').split('\n')[0]);
    expect(next.continuation).toBe(1);
    const restarted = Bun.spawn([process.execPath, new URL('../server.js', import.meta.url).pathname], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', BUNTTY_LOG_DIR: dir }, stdout: 'pipe', stderr: 'pipe'
    });
    try {
      const reader = restarted.stdout.getReader();
      let text = '', match;
      while (!(match = text.match(/http:\/\/127\.0\.0\.1:\d+/))) {
        const part = await reader.read();
        if (part.done) throw new Error('Restarted server exited before startup');
        text += new TextDecoder().decode(part.value);
      }
      const listing = await (await fetch(match[0] + '/api/logs')).json();
      expect(listing.files.slice().sort()).toEqual(files);
      const saved = await (await fetch(match[0] + '/api/logs?file=' + files[0])).json();
      expect(saved.records.some(event => event.command === 'large command')).toBe(true);
    } finally { restarted.kill(); await restarted.exited; }
  } finally {
    if (prior === undefined) delete process.env.BUNTTY_LOG_DIR; else process.env.BUNTTY_LOG_DIR = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});
