"""Copy a checkout into a scratch tree and instrument fragment compilation.

Prints the scratch path for capture.mjs. The supplied checkout is never modified.
This is a version-specific experiment, not a general profiling interface.
"""
import pathlib
import shutil
import sys
import tempfile

source = pathlib.Path(sys.argv[1]).resolve()
target = pathlib.Path(tempfile.mkdtemp(prefix='n64js-ram-store-profile-'))
shutil.copytree(source / 'src', target / 'src')
shutil.copy2(source / 'package.json', target / 'package.json')
(target / 'node_modules').symlink_to((source / 'node_modules').resolve(), target_is_directory=True)
compiler = target / 'src/cpu/r4300.js'
text = compiler.read_text()
original = 'function addOpToFragment(fragment, entry_pc, instruction, c) {'
wrapper = '''function addOpToFragment(...args) {
  const start = performance.now();
  const instrumentationStart = globalThis.__instrumentationMs;
  try { return addOpToFragmentMeasured(...args); }
  finally { globalThis.__codegenMs += performance.now() - start - (globalThis.__instrumentationMs - instrumentationStart); }
}
function addOpToFragmentMeasured(fragment, entry_pc, instruction, c) {'''
constructor = 'new Function("c", "cpu1", "rsp", code)'
assert text.count(original) == 1 and text.count(constructor) == 1, 'Compiler changed; review the instrumentation.'
text = text.replace(original, wrapper).replace(constructor, 'globalThis.__compileFragment("c", "cpu1", "rsp", code)')
compiler.write_text(text)
print(target)
