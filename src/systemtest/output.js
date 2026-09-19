import { RunStatus } from './status.js';

// ISViewer output from both legacy and current nemu64-test ROMs.
export class SystemTestOutput {
  status = RunStatus.RUNNING;
  currentTest = null;
  headings = [];
  failures = {};
  failureTests = {};
  tests = 0;
  failed = 0;
  summaryStarted = false;

  consume(line) {
    const running = line.match(/^Running (.+)\.\.\.$/);
    if (running) {
      this.currentTest = running[1];
      this.headings.push(this.currentTest);
      return;
    }

    const failure = line.match(/^Test (.+?) failed(?: with (?:unknown )?exception)?:/);
    if (failure) {
      this.failures[failure[1]] = (this.failures[failure[1]] ?? 0) + 1;
      this.failureTests[failure[1]] = this.currentTest;
      return;
    }

    if (line.includes('Exception storm detected. Aborting.')) {
      this.status = RunStatus.STORM;
      return;
    }
    if (line.includes('Done, but no tests were executed')) {
      this.status = RunStatus.EMPTY;
      return;
    }

    const legacy = line.match(/Done! Tests:\s*(\d+)\. Failed:\s*(\d+)/);
    if (legacy) {
      this.tests = Number(legacy[1]);
      this.failed = Number(legacy[2]);
      this.status = this.tests > 0 ? RunStatus.COMPLETE : RunStatus.EMPTY;
      return;
    }

    if (/^n64-systemtest .+\(base=/.test(line)) this.summaryStarted = true;
    if (!this.summaryStarted) return;

    const category = line.match(/(?:^|s\. )(?:Base|Timing|Cycle|CP0-hazards|Poorly-understood-quirk): Failed (\d+) of (\d+) tests/);
    if (category) {
      this.failed += Number(category[1]);
      this.tests += Number(category[2]);
    }
    if (line.startsWith('Slowest tests:')) {
      this.status = this.tests > 0 ? RunStatus.COMPLETE : RunStatus.EMPTY;
    }
  }
}
