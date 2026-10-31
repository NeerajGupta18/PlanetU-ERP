/** The institute code the sign-in form starts with (client/src/lib/instituteCode.js) - run with `npm test`. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initialInstituteCode } from '../../client/src/lib/instituteCode.js';

describe('institute code on the sign-in form', () => {
  it('does not take the name of the shared hosting address for an institute', () => {
    assert.equal(initialInstituteCode('planetu-erp.onrender.com', ''), '');
  });
  it('keeps the code this device saved, on the shared address', () => {
    assert.equal(initialInstituteCode('planetu-erp.onrender.com', 'demo-college'), 'demo-college');
  });
  it('takes the institute from its own address, ahead of a saved code', () => {
    assert.equal(initialInstituteCode('horizon.planetu.in', 'demo-college'), 'horizon');
    assert.equal(initialInstituteCode('Horizon.planetu.in', ''), 'horizon');
  });
  it('does not take the name of the site for an institute', () => {
    for (const host of ['www.planetu.in', 'app.planetu.in', 'erp.planetu.in']) assert.equal(initialInstituteCode(host, 'demo-school'), 'demo-school');
  });
  it('uses the saved code on a plain address, on localhost and on an IP address', () => {
    for (const host of ['planetu.in', 'localhost', '192.168.1.5']) assert.equal(initialInstituteCode(host, 'demo-school'), 'demo-school');
    assert.equal(initialInstituteCode('localhost'), '');
  });
});
