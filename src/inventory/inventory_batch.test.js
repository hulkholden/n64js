import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInputScript } from './inventory_input.js';
import { discoverROMs } from './inventory_batch.js';
import { invokeCLI, makeROM, swapRomBytes16, withDirectory } from './test_helpers.js';

const batchCLI = fileURLToPath(new URL('./inventory_batch.js', import.meta.url));
const queryCLI = fileURLToPath(new URL('./inventory_query.js', import.meta.url));

describe('inventory batch command', () => {
  test('prints usage with --help and rejects invalid CLI arguments', async () => {
    const help = await invokeCLI(batchCLI, ['--help']);
    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: bun run inventory-batch');

    await withDirectory('n64js-inventory-batch-', async directory => {
      await Bun.write(join(directory, 'empty/readme.txt'), 'not a ROM');
      const noRoms = await invokeCLI(batchCLI, ['empty', '--output-dir', 'inventory'], { cwd: directory });
      expect(noRoms.code).toBe(2);
      expect(noRoms.stderr).toContain('No ROM files found');

      for (const args of [
        [],
        ['--output-dir', 'inventory'],
        ['empty'],
        ['--resume', ''],
        ['--resume', 'inventory', 'extra.z64'],
      ]) {
        const invalid = await invokeCLI(batchCLI, args, { cwd: directory });
        expect(invalid.code).toBe(2);
        expect(invalid.stdout).toBe('');
      }
    });
  });

  test('scans nested directories, shares reports across ROM byte orders, and continues after failures', async () => {
    await withDirectory('n64js-inventory-batch-', async directory => {
      const rom = makeROM({ vi: true });
      await Bun.write(join(directory, 'roms/a-bad.n64'), 'invalid');
      await Bun.write(join(directory, 'roms/b-good.z64'), rom);
      await Bun.write(join(directory, 'roms/sub/c-copy.V64'), swapRomBytes16(rom));
      await Bun.write(join(directory, 'roms/ignored.txt'), 'not a ROM');
      await symlink('.', join(directory, 'roms/directory-loop'));
      const result = await invokeCLI(batchCLI, ['roms', 'missing.z64', '--output-dir', 'inventory', '--frames', '1'], { cwd: directory });
      expect(result.code).toBe(1);
      const scanDirectory = result.stdout.trim();
      const manifestPath = join(scanDirectory, 'manifest.json');
      const manifest = await Bun.file(manifestPath).json();
      expect(manifest.status).toBe('completed');
      expect(manifest.entries).toHaveLength(4);
      const good = manifest.entries.filter(entry => entry.status === 'completed');
      const bad = manifest.entries.filter(entry => entry.status === 'error');
      expect(good).toHaveLength(2);
      expect(bad).toHaveLength(2);
      const hash = createHash('sha256').update(rom).digest('hex');
      expect(good.every(entry => entry.sha256 === hash && entry.report === `${hash}.json`)).toBe(true);
      const report = await Bun.file(join(scanDirectory, good[0].report)).json();
      expect(report.settings).toEqual(manifest.settings);
      expect(report.rom.sha256).toBe(hash);
      expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(2);
      const queried = await invokeCLI(queryCLI, [scanDirectory, '--microcode', 'GBI2'], { cwd: directory });
      expect(queried.code).toBe(0);
      const query = JSON.parse(queried.stdout);
      expect(query.summary).toEqual({ matched: 1, notObserved: 0, unknown: 2, errors: 0 });
      expect(query.matches[0]).toMatchObject({
        rom: report.rom, paths: good.map(entry => entry.path), settings: report.settings,
      });
      for (const entry of bad) {
        expect(await Bun.file(join(scanDirectory, entry.report)).json()).toMatchObject({
          rom: null, collectors: {}, result: { status: 'error' },
        });
      }

      // Recover a published report whose manifest update did not finish.
      good[0].status = 'pending';
      await Bun.write(manifestPath, JSON.stringify(manifest));
      const files = [...new Set(manifest.entries.map(entry => entry.report))];
      const inodes = await Promise.all(files.map(file => stat(join(scanDirectory, file)).then(info => info.ino)));
      const resumed = await invokeCLI(batchCLI, ['--resume', scanDirectory], { cwd: directory });
      expect(resumed.code).toBe(1);
      expect((await Bun.file(manifestPath).json()).entries.every(entry => entry.status !== 'pending')).toBe(true);
      expect(await Promise.all(files.map(file => stat(join(scanDirectory, file)).then(info => info.ino)))).toEqual(inodes);

      const second = await invokeCLI(batchCLI, ['roms/b-good.z64', '--output-dir', 'inventory', '--frames', '1', '--seed', '2'], { cwd: directory });
      expect(second.code).toBe(0);
      expect(second.stdout.trim()).not.toBe(scanDirectory);
      expect((await Bun.file(join(second.stdout.trim(), `${hash}.json`)).json()).settings.seed).toBe(2);
      expect(await Bun.file(join(scanDirectory, `${hash}.json`)).json()).toEqual(report);
    });
  });

  test('discovers valid file symlinks and records broken file symlinks as errors', async () => {
    await withDirectory('n64js-inventory-batch-', async directory => {
      const targetPath = join(directory, 'target.rom');
      await Bun.write(targetPath, makeROM({ vi: true }));
      await Bun.write(join(directory, 'roms/placeholder.txt'), '');
      await symlink(targetPath, join(directory, 'roms/valid.z64'));
      await symlink(join(directory, 'missing-target.z64'), join(directory, 'roms/broken.z64'));

      const result = await invokeCLI(batchCLI, ['roms', '--output-dir', 'inventory', '--frames', '1'], { cwd: directory });
      expect(result.code).toBe(1);
      const manifest = await Bun.file(join(result.stdout.trim(), 'manifest.json')).json();
      expect(manifest.entries.map(entry => [entry.path, entry.status])).toEqual([
        [join(directory, 'roms/broken.z64'), 'error'],
        [join(directory, 'roms/valid.z64'), 'completed'],
      ]);
    });
  });

  test('keeps seed scans independent, continues after failures, and resumes them together', async () => {
    await withDirectory('n64js-inventory-batch-', async directory => {
      const rom = makeROM({ vi: true, waitForInput: true });
      await Bun.write(join(directory, 'roms/a.z64'), rom);
      await Bun.write(join(directory, 'roms/b.z64'), rom);
      const script = { version: 1, steps: [{ frames: 2 }, { frames: 3, buttons: ['START'], stickX: 80, stickY: -48 }] };
      await Bun.write(join(directory, 'menu.json'), JSON.stringify(script));
      const result = await invokeCLI(batchCLI, [
        'roms', 'missing.z64', '--output-dir', 'inventory', '--frames', '5',
        '--seed', '2', '--seed', '0', '--seed', '02', '--input-script', 'menu.json',
      ], { cwd: directory });
      expect(result.code).toBe(1);
      const directories = result.stdout.trim().split('\n');
      expect(directories).toHaveLength(2);
      const manifests = await Promise.all(directories.map(path => Bun.file(join(path, 'manifest.json')).json()));
      expect(manifests.map(manifest => manifest.settings.seed)).toEqual([2, 0]);
      const reportPaths = [];
      for (const [index, manifest] of manifests.entries()) {
        expect(manifest.status).toBe('completed');
        const good = manifest.entries.filter(entry => entry.status === 'completed');
        expect(good).toHaveLength(2);
        expect(good[0].report).toBe(good[1].report);
        expect(manifest.entries.filter(entry => entry.status === 'error')).toHaveLength(1);
        const path = join(directories[index], good[0].report);
        reportPaths.push(path);
        const report = await Bun.file(path).json();
        expect(report.settings).toEqual(manifest.settings);
        expect(report.settings.inputPolicy.script).toEqual(parseInputScript(script));
        expect(report.collectors['graphics.taskMicrocodes'].tasks).toBe(2);
      }
      const queried = await invokeCLI(queryCLI, ['inventory', '--microcode', 'GBI2'], { cwd: directory });
      expect(queried.code).toBe(0);
      const query = JSON.parse(queried.stdout);
      expect(query.summary).toEqual({ matched: 2, notObserved: 0, unknown: 2, errors: 0 });
      expect(query.matches.map(match => match.settings.seed).sort()).toEqual([0, 2]);
      expect(query.matches.every(match => match.paths.length === 2)).toBe(true);

      // Force a worker to replay the embedded script after its source file is gone.
      const original = await Bun.file(reportPaths[0]).json();
      await rm(reportPaths[0]);
      await rm(join(directory, 'menu.json'));
      const before = await stat(reportPaths[1]);
      const resumed = await invokeCLI(batchCLI, [...directories, directories[0]].flatMap(path => ['--resume', path]), { cwd: directory });
      expect(resumed.code).toBe(1);
      expect(resumed.stdout.trim().split('\n')).toEqual(directories);
      expect(await Bun.file(reportPaths[0]).json()).toEqual(original);
      expect((await stat(reportPaths[1])).ino).toBe(before.ino);
    });
  });

  test('saves interruption, resumes unfinished ROMs and seeds, and repairs missing reports', async () => {
    await withDirectory('n64js-inventory-batch-', async directory => {
      await Bun.write(join(directory, 'roms/a-good.z64'), makeROM({ vi: true }));
      await Bun.write(join(directory, 'roms/b-loop.z64'), makeROM({ graphics: 'wait' }));
      await Bun.write(join(directory, 'roms/c-textures.z64'), makeROM({ vi: true, graphics: 'textures' }));
      const child = Bun.spawn([process.execPath, batchCLI, 'roms', '--output-dir', 'inventory', '--frames', '1', '--max-cycles', '5000000000000', '--timeout-ms', '2000', '--seed', '1', '--seed', '2'], {
        cwd: directory, stdout: 'pipe', stderr: 'pipe',
      });
      const stdout = new Response(child.stdout).text();
      const stderr = new Response(child.stderr).text();
      let scanDirectory;
      let laterDirectory;
      try {
        let ready = false;
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const runs = await readdir(join(directory, 'inventory/runs')).catch(() => []);
          for (const run of runs) {
            const path = join(directory, 'inventory/runs', run);
            const manifest = await Bun.file(join(path, 'manifest.json')).json().catch(() => null);
            if (manifest?.settings.seed === 2) {
              laterDirectory = path;
            }
            if (manifest?.settings.seed === 1 && manifest.entries[0].status === 'completed' && manifest.entries[1].report) {
              scanDirectory = path;
            }
          }
          if (scanDirectory && laterDirectory) {
            ready = true;
            break;
          }
          await Bun.sleep(10);
        }
        expect(ready).toBe(true);
        child.kill('SIGTERM');
        expect(await child.exited).toBe(143);
        expect((await stdout).trim().split('\n')).toEqual([scanDirectory, laterDirectory]);
        const manifestPath = join(scanDirectory, 'manifest.json');
        const stopped = await Bun.file(manifestPath).json();
        expect(stopped.status).toBe('interrupted');
        expect(stopped.entries.map(entry => entry.status)).toEqual(['completed', 'interrupted', 'pending']);
        const later = await Bun.file(join(laterDirectory, 'manifest.json')).json();
        expect(later.status).toBe('pending');
        expect(later.entries.every(entry => entry.status === 'pending' && entry.report === null)).toBe(true);
        expect(await Bun.file(join(scanDirectory, '.lock')).exists()).toBe(false);
        expect(await Bun.file(join(laterDirectory, '.lock')).exists()).toBe(false);
        const goodPath = join(scanDirectory, stopped.entries[0].report);
        const before = await stat(goodPath);
        const resumed = await invokeCLI(batchCLI, ['--resume', scanDirectory, '--resume', laterDirectory], { cwd: directory });
        expect(resumed.code).toBe(1);
        expect((await stat(goodPath)).ino).toBe(before.ino);
        expect((await Bun.file(manifestPath).json()).entries.map(entry => entry.status)).toEqual(['completed', 'timeout', 'completed']);
        expect((await Bun.file(join(laterDirectory, 'manifest.json')).json()).entries.map(entry => entry.status)).toEqual(['completed', 'timeout', 'completed']);

        await rm(goodPath);
        const repaired = await invokeCLI(batchCLI, ['--resume', scanDirectory], { cwd: directory });
        expect(repaired.code).toBe(1);
        expect((await Bun.file(goodPath).json()).result.status).toBe('completed');
      } finally {
        child.kill();
        await child.exited;
        await Promise.all([stdout, stderr]);
      }
    });
  }, 15000);

  test('saves SIGINT interruption with exit code 130 and releases lock', async () => {
    await withDirectory('n64js-inventory-batch-', async directory => {
      await Bun.write(join(directory, 'wait.z64'), makeROM({ graphics: 'wait' }));
      const child = Bun.spawn([process.execPath, batchCLI, 'wait.z64', '--output-dir', 'inventory', '--frames', '1', '--max-cycles', '5000000000000', '--timeout-ms', '5000'], {
        cwd: directory, stdout: 'pipe', stderr: 'pipe',
      });
      const stdout = new Response(child.stdout).text();
      const stderr = new Response(child.stderr).text();
      let scanDirectory;
      try {
        let ready = false;
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const runs = await readdir(join(directory, 'inventory/runs')).catch(() => []);
          for (const run of runs) {
            const path = join(directory, 'inventory/runs', run);
            const manifest = await Bun.file(join(path, 'manifest.json')).json().catch(() => null);
            if (manifest?.entries[0]?.report !== null) {
              scanDirectory = path;
              ready = true;
              break;
            }
          }
          if (ready) {
            break;
          }
          await Bun.sleep(10);
        }
        expect(ready).toBe(true);
        child.kill('SIGINT');
        expect(await child.exited).toBe(130);
        expect((await stdout).trim()).toBe(scanDirectory);
        const manifest = await Bun.file(join(scanDirectory, 'manifest.json')).json();
        expect(manifest.status).toBe('interrupted');
        expect(manifest.entries[0].status).toBe('interrupted');
        expect(await Bun.file(join(scanDirectory, '.lock')).exists()).toBe(false);
      } finally {
        child.kill();
        await child.exited;
        await Promise.all([stdout, stderr]);
      }
    });
  }, 15000);

  test('rejects conflicting resumes, changed ROMs, and tampered reports without altering saved results', async () => {
    await withDirectory('n64js-inventory-batch-', async directory => {
      await Bun.write(join(directory, 'roms/a.z64'), makeROM({ vi: true }));
      await Bun.write(join(directory, 'roms/b.z64'), makeROM({ vi: true, graphics: 'textures' }));
      const result = await invokeCLI(batchCLI, ['roms', '--output-dir', 'inventory', '--frames', '1'], { cwd: directory });
      expect(result.code).toBe(0);
      const scanDirectory = result.stdout.trim();
      const manifestPath = join(scanDirectory, 'manifest.json');
      const original = await readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(original);
      const reportPath = join(scanDirectory, manifest.entries[0].report);
      const report = await readFile(reportPath, 'utf8');
      const secondReportPath = join(scanDirectory, manifest.entries[1].report);
      const secondReport = await readFile(secondReportPath, 'utf8');

      await Bun.write(join(scanDirectory, '.lock'), 'another scanner');
      const locked = await invokeCLI(batchCLI, ['--resume', scanDirectory], { cwd: directory });
      expect(locked.code).toBe(2);
      expect(locked.stderr).toContain('Scan is locked');
      await rm(join(scanDirectory, '.lock'));
      const settings = await invokeCLI(batchCLI, ['--resume', scanDirectory, '--seed', '2'], { cwd: directory });
      expect(settings.code).toBe(2);
      expect(await readFile(manifestPath, 'utf8')).toBe(original);

      // Corrupting a saved report's settings fails validation on resume.
      const tampered = JSON.parse(secondReport);
      tampered.settings.seed = 99;
      await Bun.write(secondReportPath, JSON.stringify(tampered));
      manifest.entries[1].status = 'pending';
      await Bun.write(manifestPath, JSON.stringify(manifest));
      const mismatched = await invokeCLI(batchCLI, ['--resume', scanDirectory], { cwd: directory });
      expect(mismatched.code).toBe(2);
      expect(mismatched.stderr).toContain('Report does not match this scan');
      expect(await readFile(reportPath, 'utf8')).toBe(report);
      await Bun.write(secondReportPath, secondReport);
      await Bun.write(manifestPath, original);

      // Mutating a ROM whose report is missing fails the pre-run hash check without altering earlier reports.
      await rm(secondReportPath);
      await Bun.write(join(directory, 'roms/b.z64'), makeROM({ vi: true, audio: true }));
      const changedRom = await invokeCLI(batchCLI, ['--resume', scanDirectory], { cwd: directory });
      expect(changedRom.code).toBe(2);
      expect(changedRom.stderr).toContain('ROM changed since this scan started');
      expect(await readFile(reportPath, 'utf8')).toBe(report);

      manifest.sourceSha256 = '0'.repeat(64);
      await Bun.write(manifestPath, JSON.stringify(manifest));
      const changed = await invokeCLI(batchCLI, ['--resume', scanDirectory], { cwd: directory });
      expect(changed.code).toBe(2);
      expect(changed.stderr).toContain('Emulator source, revision or runtime changed');
      manifest.entries[0].report = '../outside.json';
      await Bun.write(manifestPath, JSON.stringify(manifest));
      const invalid = await invokeCLI(batchCLI, ['--resume', scanDirectory], { cwd: directory });
      expect(invalid.code).toBe(2);
      expect(invalid.stderr).toContain('Invalid ROM entry');
      expect(await readFile(reportPath, 'utf8')).toBe(report);
    });
  });

  test('validates every seed before creating scans', async () => {
    await withDirectory('n64js-inventory-batch-', async directory => {
      const invalid = await invokeCLI(batchCLI, [
        'missing.z64', '--output-dir', 'inventory', '--seed', '1', '--seed', '4294967296',
      ], { cwd: directory });
      expect(invalid.code).toBe(2);
      expect(invalid.stderr).toContain('Invalid seed');
      expect(invalid.stdout).toBe('');
      expect(await readdir(directory)).toEqual([]);
    });
  });

  test('discoverROMs walks nested ROM files, ignores directory symlinks and non-ROMs, and rejects empty sets', async () => {
    await withDirectory('n64js-inventory-batch-', async directory => {
      const romsDir = join(directory, 'roms');
      const emptyDir = join(directory, 'empty');
      await Bun.write(join(emptyDir, 'readme.txt'), 'not a rom');
      await expect(discoverROMs([emptyDir])).rejects.toThrow('No ROM files found');

      const z64 = join(romsDir, 'a.z64');
      const v64 = join(romsDir, 'nested/b.V64');
      const n64 = join(romsDir, 'nested/c.n64');
      const brokenLink = join(romsDir, 'broken.z64');
      const explicitMissing = join(directory, 'explicit-missing.z64');
      await Bun.write(z64, 'a');
      await Bun.write(v64, 'b');
      await Bun.write(n64, 'c');
      await Bun.write(join(romsDir, 'ignored.txt'), 'd');
      await symlink(romsDir, join(romsDir, 'loop'));
      await symlink(join(directory, 'nonexistent.z64'), brokenLink);

      expect(await discoverROMs([romsDir, z64, explicitMissing])).toEqual([
        explicitMissing,
        z64,
        brokenLink,
        v64,
        n64,
      ].sort());
    });
  });
});
