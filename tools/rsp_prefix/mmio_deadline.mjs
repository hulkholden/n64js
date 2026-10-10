// Records the existing #174 discrepancy without treating it as a passing
// interpreter differential test. Run separately against baseline and prototype.
import { resolve } from 'node:path';
const [root] = process.argv.slice(2);
const { createHeadlessEmulator } = await import(resolve(root, 'src/headless/headless_env.js'));
const { setPerformanceProfiling } = await import(resolve(root, 'src/debug/performance_profile.js'));
const results = [];
for (const profiled of [false, true]) {
  for (const mode of ['interpreter', 'compiled']) {
    const { cpu0: c, hardware: h } = await createHeadlessEmulator({ romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
    const setup = () => {
      h.reset(); h.rsp.reset(); h.spRegDevice.dmaQueue = [];
      c.controlCountValue = 0; c.opsExecuted = 0; c.pc = 0x80001000;
      c.setControlU32(12, 0x20000000); c.cop1ControlChanged();
      [0, 0, 0xac800008, 0x8c820018].forEach((word, i) => h.ram.set32(0x1000 + i * 4, word));
      c.setRegS32Extend(4, 0xa4040000);
    };
    setPerformanceProfiling(false);
    setup();
    if (mode === 'compiled') {
      for (let i = 0; i < 499; i++) { h.fragmentCache.lookupFragment(c.pc); }
      c.run(12);
      const fragment = h.fragmentCache.fragments.get(0x80001000);
      if (!fragment?.func) { throw new Error('No compiled fragment'); }
      setup();
      h.fragmentCache.fragments.set(c.pc, fragment);
    }
    setPerformanceProfiling(profiled); h.rsp.setPerformanceProfiling(profiled);
    c.run(12);
    results.push({ mode, profiled, busy: c.getRegU32Lo(2), count: c.controlCountValue, dmaCycles: c.getCyclesUntilEvent('SP DMA') });
  }
}
console.log(JSON.stringify(results, null, 2));
