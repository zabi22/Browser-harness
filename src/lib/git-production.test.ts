// Test a small dependency fixture, not the application's build.
// Node-based import tests cannot detect an empty browser-external Buffer stub.
// @vitest-environment node
import { expect, it } from 'vitest';
import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { browserBufferPlugin } from '../../tooling/browser-buffer';

it('production Git initializes and hashes in a browser without Node Buffer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'obh-git-production-'));
  try {
    const entry = join(directory, 'entry.js');
    await writeFile(entry, `
      import git from ${JSON.stringify(resolve('node_modules/isomorphic-git/index.js'))};
      import { Buffer } from 'buffer';
      import { Buffer as NodeBuffer } from 'node:buffer';
      import { Buffer as SlashBuffer } from 'buffer/';
      if (Buffer !== NodeBuffer || Buffer !== SlashBuffer) throw new Error('Buffer aliases diverged');
      globalThis.gitResult = git.hashBlob({ object: Buffer.from('abc') });
    `);
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [browserBufferPlugin()],
      // Reproduce Nitro's builtin redirection, not just an isolated alias.
      resolve: { alias: [{ find: 'buffer/', replacement: 'node:buffer' }] },
      build: {
        write: false,
        minify: true,
        lib: { entry, name: 'GitRegression', formats: ['iife'] },
      },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap(value =>
      'output' in value ? value.output : [],
    );
    const chunk = output.find(value => value.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing Git test bundle');
    const browser: Record<string, unknown> = {
      console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, setTimeout, clearTimeout,
    };
    runInNewContext(chunk.code, browser);
    expect(await browser['gitResult']).toMatchObject({ oid: 'f2ba8f84ab5c1bce84a7b441cb1959cfc7093b7f' });
    expect(browser['Buffer']).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);