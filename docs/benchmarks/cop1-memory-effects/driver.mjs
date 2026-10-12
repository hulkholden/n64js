const index = Number(new URLSearchParams(location.search).get('run') || 0);
(async () => {
  while (!window.n64js?.cpu0) await new Promise(resolve => setTimeout(resolve, 100));
  const result = await (async () => {
          const n = window.n64js;
          const h = n.hardware();
          let seed = 0x12345678;
          n.cpu0.setRandomSource(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
          n.loadRomAndStartRunning(await (await fetch('/rom')).arrayBuffer());
          n.toggleRun();
          n.reset(); // Discard any synchronous frame run by toggleRun during load.
          seed = 0x12345678;
          const input = n.joybus().channels[0].inputs;
          let fatal = null;
          n.halt = message => { fatal = String(message); n.cpu0.breakExecution(); };
          const run = (frames, buttons = 0) => {
            input.buttons = buttons;
            const target = h.verticalBlankCount + frames;
            h.onVerticalBlank = count => { if (count >= target) { n.cpu0.breakExecution(); } };
            const start = performance.now();
            while (h.verticalBlankCount < target && !fatal) { n.cpu0.run(10_000_000); }
            if (fatal) { throw new Error(fatal); }
            return performance.now() - start;
          };
          run(419);
          const menus = [[10,4096],[180],[10,4096],[180],[10,4096],[420],[10,4096],[120],[10,32768],[90],[10,32768],[90],[10,32768],[90]];
          for (const step of menus) { run(...step); }
          const loadingStart = performance.now();
          for (const step of [[10,4096],[120],[240],[10,4096],[180],[180]]) { run(...step); }
          const loadingMs = performance.now() - loadingStart;
          run(15,32768); run(180);
          const startVI = h.verticalBlankCount;
          const gameplayMs = run(540);
          // Read in the same task, before async hashing permits a buffer clear.
          const canvasPNG = document.getElementById('display').toDataURL('image/png');
          const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
          const bytes = view => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
          const events = [];
          let deadline = n.cpu0.eventQueue.cyclesToFirstEvent;
          for (let event = n.cpu0.eventQueue.firstEvent; event; event = event.next) {
            events.push([event.type, deadline]); deadline += event.cyclesToNextEvent;
          }
          const state = {
            cpu: await digest(bytes(n.cpu0.gprU32)), cop0: await digest(bytes(n.cpu0.controlRegU32)),
            fpu: await digest(bytes(h.cpu1.regU32)), fcr: [...h.cpu1.control],
            ram: await digest(h.ram.u8), spmem: await digest(h.sp_mem.u8),
            rsp: await digest(bytes(h.rsp.gprU32)), vectors: await digest(bytes(h.rsp.vprU32)),
            accumulator: await digest(bytes(h.rsp.vAccU32)), rspPC: h.rsp.pc, rspDelayPC: h.rsp.delayPC,
            rspHalted: h.rsp.halted, vco: [...h.rsp.vuVCOReg], vcc: [...h.rsp.vuVCCReg], vce: [...h.rsp.vuVCEReg], div: [h.rsp.divDP, h.rsp.divIn, h.rsp.divOut], events,
            devices: Object.fromEntries(['sp_reg','mi_reg','pi_reg','si_reg','ai_reg','vi_reg','dpc_mem'].map(k => [k, [...h[k].u8]])),
          };
          const fragments = [...h.fragmentCache.fragments.values()];
          const sources = Object.fromEntries([0x7f0b0688, 0x7f0b05c0, 0x7f057f28, 0x7f0581f4].map(pc => {
            const fragment = h.fragmentCache.fragments.get(pc);
            return [pc.toString(16), fragment ? {
              ops: fragment.opsCompiled, executions: fragment.executionCount,
              pcs: fragment.instructionPCs, words: fragment.instructionWords,
              code: (fragment.func ?? fragment.cachedFunc)?.toString(),
            } : null];
          }));
          const memory = {
            fragments: fragments.length,
            compiledFragments: fragments.filter(f => f.func ?? f.cachedFunc).length,
            codeBytes: fragments.reduce((n, f) => n + ((f.func ?? f.cachedFunc)?.toString().length ?? 0), 0),
          };
          const gl = document.getElementById('display').getContext('webgl2');
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          return { runtime: navigator.userAgent, canvasPNG, memory, sources, startVI, state, loadingMs, gameplayMs, vi: h.verticalBlankCount, count: n.cpu0.controlCountValue, pc: n.cpu0.pc, delayPC: n.cpu0.delayPC, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  })();
  await fetch('/result?run=' + index, {method:'POST',body:JSON.stringify(result)});
  document.title = 'COP1 benchmark completed run ' + (index + 1);
  if (index < 9) location.replace('/?run=' + (index + 1));
})().catch(async error => {
  await fetch('/error', {method:'POST',body:String(error.stack)});
  document.title = 'COP1 benchmark failed';
});
