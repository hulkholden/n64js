"""Prepare frozen, uninstrumented variants for the allocation follow-up.

Usage: python3 prepare-overhead.py <original-checkout> <pooled-checkout> <output>
The original checkout is f2076e2; the pooled checkout is 779e2cd (reuse only).
The compact emitter is an experiment, applied only to a scratch copy.
"""
import pathlib
import shutil
import sys

original, pooled, output = map(lambda p: pathlib.Path(p).resolve(), sys.argv[1:])
for name, source in [('original', original), ('pooled', pooled), ('compact', pooled)]:
    target = output / name
    shutil.copytree(source / 'src', target / 'src', dirs_exist_ok=True)
    shutil.copy2(source / 'package.json', target / 'package.json')
    if not (target / 'node_modules').exists():
        (target / 'node_modules').symlink_to((pooled / 'node_modules').resolve(), target_is_directory=True)

path = output / 'compact/src/cpu/ram_store_group.js'
text = path.read_text()
changes = [
    ("    const fallback = fragment.bodyCode.slice(start, end);\n", ''),
    ('`ramStoreDV.setUint32(ramStoreBase + ${offset - minOffset}, c.getRegS32Lo(${rt}), false);`',
     '`if (ramStoreHit) { ramStoreDV.setUint32(ramStoreBase + ${offset - minOffset}, c.getRegS32Lo(${rt}), false); } else { c.execSW(${rt}, ${this.base}, ${offset}); }`'),
    ('  if ((ramStoreBase & 3) === 0 && ramStoreBase + ${span} <= Math.min(ramStoreDV.byteLength, 0x800000)) {\n${fast}\n  } else {\n${fallback}\n  }',
     '  const ramStoreHit = (ramStoreBase & 3) === 0 && ramStoreBase + ${span} <= Math.min(ramStoreDV.byteLength, 0x800000);\n${fast}'),
]
for before, after in changes:
    assert text.count(before) == 1, 'Emitter changed; review the experiment.'
    text = text.replace(before, after)
path.write_text(text)
print(output)
