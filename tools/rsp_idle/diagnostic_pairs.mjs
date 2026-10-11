// Run only after all throughput measurements finish.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const [baseline, prototype, output, romDirectory = '/Volumes/Data/Roms'] = process.argv.slice(2);
if (!output) { throw new Error('Usage: node diagnostic_pairs.mjs BASELINE PROTOTYPE OUTPUT [ROM_DIRECTORY]'); }
for (const [game, filename, warmup] of [
  ['mario', 'Super Mario 64 (USA).v64', 1320],
  ['diddy', 'Diddy Kong Racing (USA) (En,Fr) (Rev 1).z64', 120],
  ['goldeneye', 'GoldenEye 007 (USA).z64', 120],
]) {
  for (const [variant, source] of [['baseline', baseline], ['prototype', prototype]]) {
    const child = spawnSync('bun', [resolve('tools/rsp_idle/diagnostic.mjs'), resolve(source), resolve(romDirectory, filename), resolve(output, `diagnostic-${game}-${variant}`), String(warmup)], { encoding: 'utf8' });
    if (child.status !== 0) { throw new Error(child.stderr || child.stdout); }
    console.log(child.stdout.trim());
  }
}
