/** The step names of the seven processes (client/src/config/processes.js) - run with `npm test`. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROCESSES, attendanceProcess, processSteps } from '../../client/src/config/processes.js';

describe('process steps', () => {
  it('has every process from the plan, each with a title and steps', () => {
    for (const id of ['setup', 'admissions', 'fees', 'attendanceSchool', 'attendanceCollege', 'exams', 'family', 'onboarding']) {
      assert.ok(PROCESSES[id]?.title, `${id} has a title`);
      assert.ok(PROCESSES[id].steps.length >= 3, `${id} has steps`);
    }
  });

  it('gives every step a key and a label, with no repeats inside a process', () => {
    for (const [id, p] of Object.entries(PROCESSES)) {
      const keys = p.steps.map((s) => s.key);
      assert.equal(new Set(keys).size, keys.length, `${id} keys are unique`);
      assert.equal(new Set(p.steps.map((s) => s.label)).size, keys.length, `${id} labels are unique`);
      for (const s of p.steps) assert.ok(s.key && s.label, `${id} step is complete`);
    }
  });

  it('keeps the agreed step counts and end points', () => {
    assert.equal(processSteps('setup').length, 7);
    assert.equal(processSteps('admissions').at(-1).label, 'Enrolled');
    assert.equal(processSteps('fees').at(-1).label, 'Day-end summary');
    assert.equal(processSteps('exams').at(-1).label, 'Report cards');
  });

  it('gives colleges and universities the lecture form and everyone else the register', () => {
    assert.equal(attendanceProcess('college'), 'attendanceCollege');
    assert.equal(attendanceProcess('university'), 'attendanceCollege');
    assert.equal(attendanceProcess('school'), 'attendanceSchool');
    assert.equal(attendanceProcess('company'), 'attendanceSchool');
  });

  it('returns no steps for an unknown process instead of failing', () => {
    assert.deepEqual(processSteps('nope'), []);
  });
});
