#!/usr/bin/env python3
"""Compare inventory summaries by canonical ROM hash and seed; never infer gameplay."""
import collections
import datetime
import json
import pathlib
import re
import sys


def read(path):
    return json.loads(pathlib.Path(path).read_text())


def write(path, value):
    path = pathlib.Path(path)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    tmp.replace(path)


def key(row):
    return (row['rom']['sha256'], row['settings']['seed'])


def status(row):
    return (row.get('result') or {}).get('status', 'unknown')


def label(row):
    return pathlib.Path(row['paths'][0]).name if row['paths'] else row['rom']['name']


def records(row, name):
    return row.get('collectors', {}).get(name, {}).get('records', [])


def texture_set(row):
    return {(r['format'], r['size']) for r in records(row, 'graphics.textureFormats')
            if 0 <= r['format'] <= 4 and 0 <= r['size'] <= 3}


def reason(row):
    message = (row.get('result') or {}).get('message') or status(row)
    if 'Unsupported graphics microcode:' in message:
        return 'Unsupported graphics microcode:' + message.split('Unsupported graphics microcode:',1)[1].split(' (version')[0]
    return re.sub(r'0x[0-9a-fA-F]+', '<hex>', message)


def brief(row):
    return {'sha256': key(row)[0], 'seed': key(row)[1], 'name': label(row),
            'paths': row['paths'], 'reportPath': row['reportPath'], 'result': row['result']}


def pair(old, new):
    return {'sha256': key(new)[0], 'seed': key(new)[1], 'name': label(new),
            'before': brief(old), 'after': brief(new)}


def by_rom(rows):
    groups = collections.defaultdict(list)
    for row in rows:
        groups[key(row)[0]].append(row)
    return groups


def rom_outcomes(rows):
    groups = by_rom(rows)
    counts = collections.Counter()
    for group in groups.values():
        successes = sum(status(r) == 'completed' for r in group)
        counts['allSeedsCompleted' if successes == len(group) else 'someSeedsCompleted' if successes else 'noSeedsCompleted'] += 1
    return dict(counts)


def md(text):
    return str(text).replace('|', '\\|').replace('\n', ' ')


def link(path, name='report'):
    return f'[{name}](<{path}>)'


def analyze(root):
    root = pathlib.Path(root)
    cfg = read(root / 'config.json')
    old_doc, new_doc = read(root / 'baseline-summary.json'), read(root / 'summary.json')
    if old_doc['errors'] or new_doc['errors']:
        raise ValueError('Summary contains data errors; refusing a misleading comparison')
    old_rows, new_rows = old_doc['runs'], new_doc['runs']
    for rows in (old_rows, new_rows):
        if any(not (r.get('rom') or {}).get('sha256') or status(r) in ('unknown', 'pending', 'interrupted') for r in rows):
            raise ValueError('Incomplete or unidentified reports; comparison requires a finished scan')
        if len({key(r) for r in rows}) != len(rows):
            raise ValueError('Duplicate hash/seed keys')
    old, new = {key(r): r for r in old_rows}, {key(r): r for r in new_rows}
    common = sorted(old.keys() & new.keys())
    if any(old[k]['settings'] != new[k]['settings'] for k in common):
        raise ValueError('Settings differ for matched runs')
    if any(old[k]['emulator']['runtimeVersion'] != new[k]['emulator']['runtimeVersion'] for k in common):
        raise ValueError('Runtime versions differ')
    transitions = collections.Counter((status(old[k]), status(new[k])) for k in common)
    improvements, regressions, changed_failures, coverage_loss, texture_changes = [], [], [], [], []
    for k in common:
        a, b = old[k], new[k]
        sa, sb = status(a), status(b)
        if sa != 'completed' and sb == 'completed':
            improvements.append(pair(a, b))
        elif sa == 'completed' and sb != 'completed':
            regressions.append(pair(a, b))
        elif sa != 'completed' and sb != 'completed' and (sa != sb or reason(a) != reason(b)):
            changed_failures.append(pair(a, b))
        at, bt = texture_set(a), texture_set(b)
        if at != bt:
            texture_changes.append({**pair(a, b), 'gained': sorted(bt-at), 'lost': sorted(at-bt)})
        if sa == sb == 'completed' and at and not bt:
            coverage_loss.append(pair(a, b))

    checks = read(root / 'rechecks.json') if (root / 'rechecks.json').exists() else []
    checked = {(r['sha256'], r['seed']): r for r in checks}
    failures = [r for r in new_rows if status(r) != 'completed']
    groups = collections.defaultdict(list)
    for row in failures:
        groups[(status(row), reason(row))].append(row)
    failure_groups = []
    for (outcome, message), rows in groups.items():
        first = rows[0]
        failure_groups.append({'status': outcome, 'reason': message, 'runs': len(rows),
                               'roms': len(by_rom(rows)), 'examples': [brief(r) for r in rows[:5]],
                               'members': [brief(r) for r in rows]})
    failure_groups.sort(key=lambda x: (-x['roms'], -x['runs'], x['reason']))
    no_textures = [group for group in by_rom(new_rows).values()
                   if any(status(r) == 'completed' for r in group) and not any(texture_set(r) for r in group)]
    result = {
        'schemaVersion': 1, 'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'baseline': cfg['baseline'], 'revision': cfg['revision'],
        'matchedRuns': len(common), 'addedRuns': [brief(new[k]) for k in sorted(new.keys()-old.keys())],
        'removedRuns': [brief(old[k]) for k in sorted(old.keys()-new.keys())],
        'before': old_doc['summary'], 'after': new_doc['summary'],
        'beforeRomOutcomes': rom_outcomes(old_rows), 'afterRomOutcomes': rom_outcomes(new_rows),
        'transitions': [{'before': a, 'after': b, 'runs': n} for (a,b),n in sorted(transitions.items())],
        'improvements': improvements, 'regressionCandidates': regressions,
        'changedFailures': changed_failures, 'textureCoverageLossCandidates': coverage_loss,
        'textureChanges': texture_changes, 'failureGroups': failure_groups,
        'completedWithoutTexturesAcrossSeeds': [brief(group[0]) for group in no_textures],
        'rechecks': checks,
    }
    write(root / 'comparison.json', result)
    write(root / 'regression-candidates.json', regressions)
    write(root / 'failure-groups.json', failure_groups)
    write(root / 'coverage-changes.json', {'completeTextureLoss': coverage_loss, 'textureChanges': texture_changes,
                                          'completedWithoutTexturesAcrossSeeds': result['completedWithoutTexturesAcrossSeeds']})
    outcomes = sorted(set(old_doc['summary']['statuses']) | set(new_doc['summary']['statuses']))
    old_success, new_success = (doc['summary']['statuses'].get('completed', 0) for doc in (old_doc, new_doc))
    timing = read(root / 'timing.json') if (root / 'timing.json').exists() else {}
    lines = [f'# ROM inventory comparison — {cfg["revision"][:7]}', '',
             f'{len(new_rows):,} runs across {new_doc["summary"]["roms"]:,} distinct ROM images; '
             f'{len(common):,} runs matched by canonical SHA-256 and seed.', '',
             f'Completed: **{old_success:,} → {new_success:,}** ({new_success-old_success:+,} runs). '
             f'**{len(improvements)}** previously failing runs reached the budget; '
             f'**{len(regressions)}** previously completed runs now stop early.', '',
             f'A completed run reaches {cfg["frames"]:,} VI retraces. It does not establish gameplay progress, correct rendering, or audio quality. '
             f'The scan uses HLE with a null renderer, fresh saves, seeds {cfg["seeds"]}, '
             f'{cfg["maxCycles"]:,} cycles and {cfg["timeoutMs"]/1000:g} seconds per run. '
             'See config and report settings for the input policy. Missing historical collectors are unknown, not regressions.', '',
             f'Baseline: {cfg["baseline"]}. New revision: `{cfg["revision"]}`; Bun {cfg["runtimeVersion"]}. '
             f'Batch elapsed hours: {timing.get("batchElapsedHours", "unavailable")}.', '',
             '| Outcome | Baseline | Current | Change |', '| --- | ---: | ---: | ---: |']
    for outcome in outcomes:
        a,b = old_doc['summary']['statuses'].get(outcome,0), new_doc['summary']['statuses'].get(outcome,0)
        lines.append(f'| {outcome} | {a} | {b} | {b-a:+} |')
    lines += ['', '| ROM outcome across seeds | Baseline | Current |', '| --- | ---: | ---: |']
    for kind in ['allSeedsCompleted','someSeedsCompleted','noSeedsCompleted']:
        lines.append(f'| {kind} | {result["beforeRomOutcomes"].get(kind,0)} | {result["afterRomOutcomes"].get(kind,0)} |')
    lines += ['', f'Unmatched runs: {len(result["addedRuns"])} added, {len(result["removedRuns"])} removed. '
              'Unmatched images are excluded from transitions.', '', '## Regressions and rechecks', '',
              'A single replay is a reproducibility check, not a statistical performance test. '
              'Timeout-only differences remain timing-sensitive even when they repeat.']
    if regressions:
        lines += ['', '| ROM | Seed | Baseline → current | Recheck | Evidence |', '| --- | ---: | --- | --- | --- |']
        for r in sorted(regressions, key=lambda r:(r['name'],r['seed'])):
            c = checked.get((r['sha256'],r['seed']),{})
            lines.append(f'| {md(r["name"])} | {r["seed"]} | completed → {r["after"]["result"]["status"]} | '
                         f'{md(c.get("verdict","pending"))} | {link(r["after"]["reportPath"])} |')
    else:
        lines += ['', 'No matched run changed from completed to an early stop.']
    lines += ['', '## Improvements', '']
    improved_groups = collections.defaultdict(list)
    for r in improvements:
        improved_groups[r['sha256']].append(r)
    if improvements:
        lines += ['| ROM | Improved seeds | Previous outcomes | Evidence |', '| --- | --- | --- | --- |']
        for rows in sorted(improved_groups.values(),key=lambda rows:rows[0]['name']):
            r=rows[0]
            lines.append(f'| {md(r["name"])} | {", ".join(str(r["seed"]) for r in rows)} | '
                         f'{", ".join(sorted({r["before"]["result"]["status"] for r in rows}))} | {link(r["after"]["reportPath"])} |')
    else:
        lines += ['No matched failing run newly reached the VI budget.']
    lines += ['', '## Changed failures and coverage', '',
              f'{len(changed_failures)} non-completed runs changed outcome or stop reason. These are not counted as fixes. '
              'In particular, an explicit unsupported-microcode error can replace a misleading crash or stalled run.', '',
              f'{len(coverage_loss)} completed-to-completed runs lost all recorded valid texture formats; these require '
              f'replay or visual investigation. {len(no_textures)} images complete at least one seed but show no valid textures '
              'at any seed. Texture gains or losses can reflect different random-input paths and are not visual correctness results.', '',
              link(root/'coverage-changes.json','Coverage details')+' · '+link(root/'comparison.json','All transitions and changed failures'), '',
              '## Remaining failure groups', '',
              'Groups share a reported symptom; root causes still need diagnosis. Regions and revisions count as separate ROM images.', '',
              '| Stop reason | Runs | ROM images | Example |', '| --- | ---: | ---: | --- |']
    for g in failure_groups:
        e=g['examples'][0]
        lines.append(f'| {md(g["reason"])} | {g["runs"]} | {g["roms"]} | {link(e["reportPath"],md(e["name"]))} |')
    lines += ['', link(root/'hot-list.md','Prioritized issue hot list')+' · '+link(root/'summary.json','Current summary')+
              ' · '+link(root/'comparison.json','Machine-readable comparison')+' · '+link(root/'rechecks.json','Recheck evidence'), '']
    (root/'report.md').write_text('\n'.join(lines))
    hot = ['# Inventory issue hot list', '', 'Priorities are based on reproduced regressions, affected ROM images, and blocked startup. '
           'Symptom groups are investigation leads, not established shared root causes.', '']
    confirmed = [r for r in regressions if checked.get((r['sha256'],r['seed']),{}).get('verdict') == 'reproduced-regression']
    if confirmed:
        hot += [f'1. **P1 — Reproduced new failures ({len(confirmed)} runs).** Current replay stops early while '
                'the retained baseline replay completes. Start with the stack/context in each report.', '']
        for r in confirmed:
            hot.append(f'   - {r["name"]}, seed {r["seed"]}: {link(r["after"]["reportPath"])}')
        hot += ['']
    if regressions and len(confirmed) != len(regressions):
        hot += [f'- **P1 triage — Other completion regressions ({len(regressions)-len(confirmed)} runs).** '
                'Consult rechecks: timing-sensitive, non-reproducing, control-failure and unverified cases must remain distinct.', '']
    zero = [r for r in failures if r['result']['frames'] == 0]
    if zero:
        hot += [f'- **P1 — Zero-VI startup blockers:** {len(zero)} runs / {len(by_rom(zero))} ROM images. '
                'Use the saved CPU/RSP context and targeted boot traces to distinguish failure causes.', '']
    for g in failure_groups[:10]:
        e=g['examples'][0]
        next_step = ('Implement or route this identified microcode; recognition alone does not provide HLE support.'
                     if 'Unsupported graphics microcode' in g['reason'] else
                     'Replay sequentially with a larger wall-clock budget and inspect checkpoint progress before changing emulation.'
                     if g['status']=='timeout' else
                     'Replay a representative hash/seed and use saved exception stack and CPU/RSP context to isolate the cause.')
        hot += [f'- **P2 — {md(g["reason"])}:** {g["runs"]} runs / {g["roms"]} ROM images. {next_step} '
                f'{link(e["reportPath"],e["name"])}', '']
    if coverage_loss or no_textures:
        hot += [f'- **P2 validation — Rendering/progress coverage:** {len(coverage_loss)} newly empty-texture completed runs; '
                f'{len(no_textures)} completed images with no textures across all seeds. Use scripted menus and browser screenshots. '
                f'{link(root/"coverage-changes.json","Evidence")}', '']
    hot += ['Performance claims require dedicated benchmarks; this scan records emulation outcomes under fixed limits.', '']
    (root/'hot-list.md').write_text('\n'.join(hot))
    return result


if __name__ == '__main__':
    result=analyze(sys.argv[1])
    print(json.dumps({'matchedRuns':result['matchedRuns'],'improvements':len(result['improvements']),
                      'regressionCandidates':len(result['regressionCandidates']),'failureGroups':len(result['failureGroups'])}))
