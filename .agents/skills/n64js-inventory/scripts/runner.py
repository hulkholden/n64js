#!/usr/bin/env python3
"""Durable sequential scan, bounded diagnostics, comparison, and regression replay."""
import argparse
import datetime
import fcntl
import json
import os
import pathlib
import signal
import shutil
import subprocess
import sys
import time
import traceback

from analyze import analyze, read, write

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive',type=pathlib.Path)
mode=parser.add_mutually_exclusive_group()
mode.add_argument('--resume',action='store_true')
mode.add_argument('--analyze-only',action='store_true')
options=parser.parse_args()
root = options.archive.resolve()
cfg = read(root/'config.json')
lock=open(root/'runner.lock','a+')
try:
    fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    parser.error('Another runner holds this archive lock')
previous=read(root/'timing.json') if (root/'timing.json').exists() else {}
if previous and not (options.resume or options.analyze_only):
    parser.error('Archive already started; inspect it before selecting --resume or --analyze-only')
if options.resume and not list(root.glob('runs/*/manifest.json')):
    parser.error('No manifests exist to resume')
attempt=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
attempt_dir=root/'attempts'/attempt
attempt_dir.mkdir(parents=True)
if previous: write(attempt_dir/'previous-timing.json',previous)
checkout = root/'checkout'
bun = root/'runtime/bun'
baseline = pathlib.Path(cfg['baseline'])
active = None
stopped = False
timing = {**previous, 'status':'running','stage':'starting','startedAt':previous.get('startedAt',datetime.datetime.now(datetime.timezone.utc).isoformat()),
          'runnerPid':os.getpid(),'batchPid':None,'romFiles':len(cfg['roms']),
          'plannedEntries':len(cfg['roms'])*len(cfg['seeds']), 'attempt':attempt}
for field in ['error','traceback','finishedAt']: timing.pop(field,None)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save_timing():
    timing['updatedAt']=now()
    write(root/'timing.json',timing)


def stop(signum, _frame):
    global stopped
    stopped=True
    if active and active.poll() is None:
        active.send_signal(signum)


signal.signal(signal.SIGINT,stop)
signal.signal(signal.SIGTERM,stop)


def run(args, name, stdout=None, cwd=None, batch=False):
    """Drain all diagnostics, retaining the first and last 1 MiB only."""
    global active
    if stopped:
        raise InterruptedError('Runner interrupted')
    started=time.monotonic()
    limit=1024*1024
    total=kept=0
    tail=bytearray()
    out_path=stdout or attempt_dir/f'{name}.stdout.log'
    with open(out_path,'wb') as out, open(attempt_dir/f'{name}.log','wb') as log:
        active=subprocess.Popen([str(a) for a in args],cwd=cwd or checkout,
                                stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.PIPE)
        timing['activePid']=active.pid
        if batch: timing['batchPid']=active.pid
        save_timing()
        while True:
            chunk=active.stderr.read(65536)
            if not chunk: break
            total+=len(chunk)
            n=min(len(chunk),max(0,limit-kept))
            if n:
                log.write(chunk[:n]);kept+=n
            if n<len(chunk):
                tail.extend(chunk[n:])
                if len(tail)>limit: del tail[:-limit]
        code=active.wait()
        if tail:
            omitted=total-kept-len(tail)
            log.write(f'\n[Diagnostics omitted: {omitted} bytes; final {len(tail)} bytes follow]\n'.encode())
            log.write(tail)
    active=None
    timing['activePid']=None
    data={'command':[str(a) for a in args],'exitCode':code,'elapsedSeconds':time.monotonic()-started,
          'stderrBytes':total,'retainedDiagnosticBytes':kept+len(tail),'finishedAt':now()}
    write(attempt_dir/f'{name}.process.json',data)
    if stopped: raise InterruptedError('Runner interrupted')
    return data


def summarize(inventory, name):
    result=run([bun,checkout/'src/inventory/inventory_summary.js',inventory],name,stdout=root/f'{name}.json')
    if result['exitCode']!=0:
        raise RuntimeError(f'{name} failed: {result}')


def replay(candidate, original, current):
    side='current' if current else 'baseline'
    target=root/'rechecks'/f'{candidate["sha256"]}-seed{candidate["seed"]}-{side}.json'
    if target.exists():
        doc=read(target)
    else:
        runtime=bun if current else baseline/'runtime/bun'
        code=checkout if current else baseline/'checkout'
        rom_path=next((path for path in candidate['after']['paths'] if pathlib.Path(path).is_file()),None)
        if rom_path is None: raise FileNotFoundError('No current ROM path exists for this replay')
        proc=run([runtime,code/'src/inventory/inventory.js',rom_path,
                  '--replay',original['reportPath'],'--output',target],
                 f'recheck-{candidate["sha256"][:12]}-{candidate["seed"]}-{side}',cwd=code)
        if not target.exists(): raise RuntimeError(f'Replay failed to produce report: {proc}')
        doc=read(target)
    if (doc.get('rom') or {}).get('sha256') != candidate['sha256']:
        raise ValueError('Replay ROM hash mismatch')
    return {'reportPath':str(target),'result':doc['result'],'emulator':doc['emulator'],'replayOf':doc.get('replayOf')}


guard=None
try:
    save_timing()
    if shutil.which('caffeinate'):
        guard=subprocess.Popen(['caffeinate','-i','-w',str(os.getpid())],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        timing['caffeinatePid']=guard.pid
    if not options.analyze_only:
        timing['stage']='batch';save_timing()
        args=[bun,checkout/'src/inventory/inventory_batch.js',*cfg['roms'],'--output-dir',root,
              '--frames',str(cfg['frames']),'--max-cycles',str(cfg['maxCycles']),'--timeout-ms',str(cfg['timeoutMs'])]
        for seed in cfg['seeds']: args+=['--seed',str(seed)]
        if cfg.get('inputScript'):
            args+=['--input-script',root/'input-script.json']
        if options.resume:
            args=[bun,checkout/'src/inventory/inventory_batch.js']
            for path in sorted((root/'runs').glob('*/manifest.json')): args+=['--resume',path.parent]
        print(f'Started {now()}: {timing["plannedEntries"]} entries',flush=True)
        proc=run(args,'batch',stdout=attempt_dir/'scan-directories.txt',batch=True)
        timing['batchExitCode']=proc['exitCode']
        timing['batchElapsedHours']=round(timing.get('batchElapsedHours',0)+proc['elapsedSeconds']/3600,4)
        timing['batchFinishedAt']=now()
        if proc['exitCode'] not in (0,1): raise RuntimeError(f'Batch did not finish: {proc["exitCode"]}')
    timing['stage']='summaries';save_timing()
    summarize(root,'summary')
    summarize(baseline,'baseline-summary')
    manifests=[read(path) for path in root.glob('runs/*/manifest.json')]
    if sorted(m['settings']['seed'] for m in manifests)!=sorted(cfg['seeds']):
        raise ValueError('Missing or duplicate seed scans')
    expected=0
    for manifest in manifests:
        if manifest['status']!='completed' or sorted(e['path'] for e in manifest['entries'])!=sorted(cfg['roms']):
            raise ValueError('Incomplete scan or input coverage mismatch')
        if any(e['status'] not in {'completed','halted','timeout','cycle-limit','error'} for e in manifest['entries']):
            raise ValueError('Non-terminal ROM entry')
        expected+=len({e['report'] for e in manifest['entries']})
    if len(read(root/'summary.json')['runs'])!=expected:
        raise ValueError('Unexpected canonical report count')
    comparison=analyze(root)
    timing['stage']='regression-rechecks';save_timing()
    (root/'rechecks').mkdir(exist_ok=True)
    checks=read(root/'rechecks.json') if (root/'rechecks.json').exists() else []
    finished={(c['sha256'],c['seed']) for c in checks}
    timing['rechecksPlanned']=len(comparison['regressionCandidates'])
    for candidate in comparison['regressionCandidates']:
        k=(candidate['sha256'],candidate['seed'])
        if k in finished: continue
        result={k:candidate[k] for k in ['sha256','seed','name']}
        try:
            result['current']=replay(candidate,candidate['after'],True)
            result['baseline']=replay(candidate,candidate['before'],False)
            current_status=result['current']['result']['status']
            control_status=result['baseline']['result']['status']
            if current_status=='completed':
                result['verdict']='not-reproduced'
            elif control_status!='completed':
                result['verdict']='baseline-control-also-failed'
            elif 'timeout' in (current_status,candidate['after']['result']['status']):
                result['verdict']='repeated-but-timing-sensitive'
            else:
                result['verdict']='reproduced-regression'
        except Exception as error:
            if stopped: raise
            result['verdict']='verification-error';result['error']=str(error)
        checks.append(result);write(root/'rechecks.json',checks)
        timing['rechecksFinished']=len(checks);save_timing()
    write(root/'rechecks.json',checks)
    timing['stage']='final-analysis';save_timing()
    comparison=analyze(root)
    timing['status']='completed';timing['stage']='completed'
    timing['analysis']={'matchedRuns':comparison['matchedRuns'],'improvements':len(comparison['improvements']),
                       'regressionCandidates':len(comparison['regressionCandidates']),
                       'recheckVerdicts':{v:sum(c['verdict']==v for c in checks) for v in {c['verdict'] for c in checks}}}
except BaseException as error:
    timing['status']='interrupted' if stopped else 'failed'
    timing['error']=str(error);timing['traceback']=traceback.format_exc()
    print(timing['traceback'],flush=True)
finally:
    timing['finishedAt']=now();save_timing()
    if guard and guard.poll() is None: guard.terminate()
    print(json.dumps(timing),flush=True)
sys.exit(0 if timing['status']=='completed' else 2)
