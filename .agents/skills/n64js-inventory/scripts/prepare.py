#!/usr/bin/env python3
"""Prepare a pinned n64js inventory archive from a completed baseline; does not launch it."""
import argparse
import datetime
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys


def prepare(args):
    repo=args.repo.resolve(); baseline=args.baseline.resolve(); root=args.output.resolve()
    manifests=[json.loads(p.read_text()) for p in baseline.glob('runs/*/manifest.json')]
    if not manifests or any(m['status']!='completed' for m in manifests):
        raise ValueError('Baseline must contain only completed seed scans')
    settings=manifests[0]['settings']
    profile=lambda s:{k:v for k,v in s.items() if k!='seed'}
    if any(profile(m['settings'])!=profile(settings) for m in manifests):
        raise ValueError('Baseline mixes settings; choose one coherent cohort')
    if settings['graphics']!='HLE' or settings['randomAlgorithm']!='mulberry32':
        raise ValueError('Unsupported baseline graphics/random policy')
    policy=settings['inputPolicy']
    if policy.get('name') not in {'random-controller','scripted-prefix'} or policy.get('version')!=1:
        raise ValueError('Unsupported input policy; inspect native replay settings')
    seeds=sorted(m['settings']['seed'] for m in manifests)
    if len(seeds)!=len(set(seeds)): raise ValueError('Baseline has duplicate seed scans')
    emulators=[m['emulator'] for m in manifests]
    if len({(e['revision'],e['runtimeVersion']) for e in emulators})!=1:
        raise ValueError('Baseline mixes source revisions or runtimes')
    bun=(args.bun or baseline/'runtime/bun').resolve()
    version=subprocess.check_output([str(bun),'--version'],text=True).strip()
    if version!=emulators[0]['runtimeVersion']: raise ValueError('Bun differs from baseline')
    if not (baseline/'checkout/src/inventory/inventory.js').is_file():
        raise ValueError('Retained baseline checkout required for control replays')
    revision=subprocess.check_output(['git','rev-parse',args.revision+'^{commit}'],cwd=repo,text=True).strip()
    roms=set()
    for directory in args.rom_root:
        if not directory.is_dir(): raise ValueError(f'ROM directory missing: {directory}')
        for p in directory.resolve().rglob('*'):
            if p.is_file() and p.suffix.lower() in {'.z64','.v64','.n64'}: roms.add(str(p))
    if not roms: raise ValueError('No ROM images discovered')
    root.mkdir(parents=True,exist_ok=False)
    checkout=root/'checkout'
    subprocess.run(['git','worktree','add','--detach',str(checkout),revision],cwd=repo,check=True)
    (root/'runtime').mkdir();shutil.copy2(bun,root/'runtime/bun')
    dependency_source=baseline/'checkout'
    same_locks=all((checkout/f).read_bytes()==(dependency_source/f).read_bytes() for f in ['package.json','bun.lock'])
    if same_locks and (dependency_source/'node_modules').is_dir():
        shutil.copytree(dependency_source/'node_modules',checkout/'node_modules',symlinks=False)
    else:
        subprocess.run([str(root/'runtime/bun'),'install','--frozen-lockfile'],cwd=checkout,check=True)
    old_paths={e['path'] for m in manifests for e in m['entries']}
    script=policy.get('script')
    if script is not None: (root/'input-script.json').write_text(json.dumps(script,indent=2)+'\n')
    cfg={'root':str(root),'baseline':str(baseline),'sourceCheckout':str(repo),'revision':revision,
         'baselineRevision':emulators[0]['revision'],'runtimeVersion':version,
         'runtimeSha256':hashlib.sha256((root/'runtime/bun').read_bytes()).hexdigest(),
         'romRoots':[str(p.resolve()) for p in args.rom_root],'roms':sorted(roms),'seeds':seeds,
         'frames':settings['frames'],'maxCycles':settings['maxCycles'],'timeoutMs':settings['timeoutMs'],
         'inputScript':script is not None,'settings':profile(settings),
         'addedPaths':sorted(roms-old_paths),'removedPaths':sorted(old_paths-roms),
         'python':sys.executable,'preparedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (root/'config.json').write_text(json.dumps(cfg,indent=2)+'\n')
    for file in ['runner.py','analyze.py','prepare.py']:
        shutil.copy2(pathlib.Path(__file__).parent/file,root/file)
    commits=subprocess.check_output(['git','log',cfg['baselineRevision']+'..'+revision,'--format=%h %s'],cwd=checkout,text=True)
    (root/'changes-since-baseline.txt').write_text(commits)
    return {'archive':str(root),'revision':revision,'romFiles':len(roms),'seeds':seeds,'launched':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',required=True,type=pathlib.Path)
    parser.add_argument('--revision',required=True)
    parser.add_argument('--baseline',required=True,type=pathlib.Path)
    parser.add_argument('--rom-root',required=True,action='append',type=pathlib.Path)
    parser.add_argument('--output',required=True,type=pathlib.Path)
    parser.add_argument('--bun',type=pathlib.Path)
    try: print(json.dumps(prepare(parser.parse_args())))
    except Exception as error: parser.exit(2,f'Preparation failed: {error}\n')
