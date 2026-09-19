#!/usr/bin/env python3
"""Reproduce issue 162's independent, alternating before/after comparisons.

Run against a checkout containing the prototype. Uses temporary git-archive
exports, an unchanged benchmark harness, and a fresh Bun process for every sample.
The output must not exist; ROM paths are supplied at runtime.
"""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def section(source, first, following):
    return source[source.index(f'function {first}('):source.index(f'function {following}(')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--baseline', default='c880ee9d3389c75708fedb19394f202ca557c2bc')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    dependencies = root / 'node_modules'
    if not dependencies.is_dir():
        raise FileNotFoundError('Run bun install in the checkout before benchmarking')
    baseline = subprocess.check_output(['git', 'rev-parse', args.baseline], cwd=root, text=True).strip()
    archive = subprocess.check_output(['git', 'archive', baseline], cwd=root)
    generator = Path('src/cpu/recompiler.js')
    prototype = (root / generator).read_text()

    with tempfile.TemporaryDirectory(prefix='n64js-word-codegen-') as temporary:
        temporary = Path(temporary)
        original = temporary / 'baseline'
        original.mkdir()
        subprocess.run(['tar', '-x', '-C', str(original)], input=archive, check=True)
        source = (original / generator).read_text()
        variants = ['immediates', 'moves', 'combined']
        for variant in variants:
            destination = temporary / variant
            shutil.copytree(original, destination)
            code = source
            if variant in ['immediates', 'combined']:
                code = code.replace(section(source, 'generateANDI', 'generateLUI'),
                                    section(prototype, 'generateANDI', 'generateLUI'))
            if variant in ['moves', 'combined']:
                code = code.replace(section(source, 'generateOR', 'generateXOR'),
                                    section(prototype, 'generateOR', 'generateXOR'))
            (destination / generator).write_text(code)
        if (temporary / 'combined' / generator).read_text() != prototype:
            raise ValueError('Prototype has generator changes outside the two measured families')
        # git archive excludes installed packages. All variants must resolve the
        # same dependencies without relying on a node_modules ancestor of /tmp.
        for mode in ['baseline', *variants]:
            (temporary / mode / 'node_modules').symlink_to(dependencies, target_is_directory=True)
        hashes = {mode: hashlib.sha256((temporary / mode / generator).read_bytes()).hexdigest()
                  for mode in ['baseline', *variants]}

        with args.output.open('x') as output:
            for rom in args.rom:
                rom = Path(rom).resolve()
                for warmup in [120, 1320]:
                    for variant in variants:
                        for pair in range(1, 6):
                            order = ['baseline', variant] if pair % 2 else [variant, 'baseline']
                            for mode in order:
                                command = ['bun', 'run', str(temporary / mode / 'src/headless/benchmark.js'),
                                           '--rom', str(rom), '--samples', '1', '--warmup-frames', str(warmup),
                                           '--frames', '600', '--json']
                                start = time.monotonic()
                                result = subprocess.run(command, capture_output=True, text=True, check=True)
                                elapsed = time.monotonic() - start
                                data = json.loads(result.stdout)
                                sample = data['results'][0]['samples'][0]
                                record = dict(baseline=baseline,
                                              generatorSHA256=hashes[mode],
                                              runtime=data['runtime'], rom=rom.name, warmup=warmup,
                                              variant=variant, pair=pair, mode=mode,
                                              processSeconds=elapsed, **sample)
                                output.write(json.dumps(record) + '\n')
                                output.flush()
                            print(rom.name, warmup, variant, pair, flush=True)


if __name__ == '__main__':
    main()
