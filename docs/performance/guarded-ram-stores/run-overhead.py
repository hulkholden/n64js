"""Run serial, alternating blocks against prepared overhead variants.

Usage: python3 run-overhead.py <prepared-root> <rom-directory>
Wait for other emulator tasks to finish first. Read-only process checks reject
blocks that overlap another busy Bun/Node/browser-renderer process.
"""
import hashlib
import json
import pathlib
import subprocess
import sys
import time

root, rom_dir = map(lambda p: pathlib.Path(p).resolve(), sys.argv[1:])
script = pathlib.Path(__file__).with_name('measure-overhead.mjs')
bun = pathlib.Path.home() / '.bun/bin/bun'
roms = {
    'turok': 'Turok - Dinosaur Hunter (USA).v64',
    'zelda': 'Legend of Zelda, The - Ocarina of Time (USA) (Rev 1).z64',
    'fzero': 'F-Zero X (USA).z64',
}
variants = ['off', 'original', 'pooled', 'compact']
def checkout(variant):
    return root / ('original' if variant == 'off' else variant)

def contention(own_pid=None):
    rows = subprocess.check_output(['ps', '-axo', 'pid,pcpu,comm'], text=True).splitlines()[1:]
    busy = []
    for row in rows:
        pid, cpu, command = row.strip().split(maxsplit=2)
        name = pathlib.Path(command).name.lower()
        if int(pid) != own_pid and float(cpu) >= 20 and (
            name in ('bun', 'node') or 'chrome helper (renderer)' in name
        ):
            busy.append({'pid': int(pid), 'cpu': float(cpu), 'command': command})
    return busy

def digest_sources(path):
    digest = hashlib.sha256()
    for source in sorted((path / 'src').rglob('*.js')):
        digest.update(str(source.relative_to(path)).encode() + b'\0' + source.read_bytes() + b'\0')
    return digest.hexdigest()

manifest = {
    'date': time.strftime('%Y-%m-%d'),
    'bun': subprocess.check_output([str(bun), '--version'], text=True).strip(),
    'harnessSHA256': hashlib.sha256(script.read_bytes()).hexdigest(),
    'sourceTreeSHA256': {v: digest_sources(checkout(v)) for v in variants},
    'samples': [], 'discardedBlocks': [],
}
started = time.monotonic()
for title, rom in roms.items():
    reference = None
    for block in range(1, 6):
        while True:
            # Require a quiet interval before the next block; do not stop other work.
            quiet_since = time.monotonic()
            while time.monotonic() - quiet_since < 10:
                if contention():
                    quiet_since = time.monotonic()
                time.sleep(1)
            samples, conflicts = [], []
            order = variants if block % 2 else variants[::-1]
            for variant in order:
                command = [str(bun), str(script), str(checkout(variant)), str(rom_dir / rom)]
                if variant == 'off':
                    command.append('off')
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                while process.poll() is None:
                    conflicts.extend(contention(process.pid))
                    time.sleep(1)
                stdout, stderr = process.communicate()
                if process.returncode:
                    raise RuntimeError(stderr)
                data = json.loads(stdout)
                identity = [(w['state'], w['cycles'], w['endVI']) for w in data['windows']]
                if reference is None:
                    reference = identity
                assert identity == reference, (title, block, variant, 'state mismatch')
                samples.append({'title': title, 'block': block, 'variant': variant, **data})
                if conflicts:
                    break
            if conflicts:
                manifest['discardedBlocks'].append({'title': title, 'block': block, 'conflicts': conflicts})
                print(title, block, 'discarded because of overlapping work', flush=True)
            else:
                manifest['samples'].extend(samples)
                rates = {s['variant']: [round(w['fps'], 2) for w in s['windows']] for s in samples}
                print(title, block, rates, 'elapsed', round(time.monotonic() - started), flush=True)
            (root / 'measurements.json').write_text(json.dumps(manifest, indent=2))
            if not conflicts:
                break
