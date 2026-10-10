// Installed only in separate diagnostic runs, before the emulator bundle loads.
export function installDiagnostics() {
  const stats = window.rspPrefixStats = {
    compilations: 0, constructionMs: 0, sourceBytes: 0, guards: 0, hits: 0,
    fragmentRuns: 0, completedCompiledOps: 0, thrownFragments: 0,
    steps: 0, haltedSteps: 0, rspInstructions: 0,
  };
  const sources = window.rspPrefixSources = new Map();
  const RealFunction = window.Function;
  window.Function = new Proxy(RealFunction, {
    apply(target, thisArg, args) { return this.construct(target, args); },
    construct(target, args) {
      const original = args.at(-1);
      const match = typeof original === 'string' && original.match(/return function fragment_(0x[0-9a-f]+)_(\d+)\(\) \{/);
      if (!match) { return Reflect.construct(target, args); }
      const record = { pc: match[1], runs: 0, source: original };
      sources.set(`${match[1]}:${stats.compilations}`, record);
      stats.compilations++;
      stats.sourceBytes += new TextEncoder().encode(original).length;
      args[args.length - 1] = original.replace('if (rsp.halted && !c.stuffToDo) {', 'if ((window.rspPrefixStats.guards++, rsp.halted && !c.stuffToDo)) { window.rspPrefixStats.hits++;');
      const start = performance.now();
      const factory = Reflect.construct(target, args);
      stats.constructionMs += performance.now() - start;
      return function (...deps) {
        const fn = factory(...deps);
        return function () {
          stats.fragmentRuns++; record.runs++;
          try {
            const ops = fn();
            stats.completedCompiledOps += ops;
            return ops;
          } catch (error) {
            // Retain completed prefixes separately; do not invent a full-length
            // return or assume that the faulting instruction was completed.
            stats.completedCompiledOps += deps[0].fragmentOps ?? 0;
            stats.thrownFragments++;
            throw error;
          }
        };
      };
    },
  });
}
