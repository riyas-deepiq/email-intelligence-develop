import assert from 'node:assert/strict';
import test from 'node:test';

import { loadComponents, resolveOrder, validate } from '../index.mjs';

test('component descriptors are valid and resolve deterministically', () => {
  const components = loadComponents();

  assert.deepEqual(validate(components), []);
  assert.deepEqual(
    resolveOrder(components).map(({ id }) => id),
    ['server', 'client', 'collector', 'rag'],
  );
});

test('validation rejects unsafe service metadata', () => {
  const problems = validate([
    {
      id: 'Bad Id',
      name: 'Broken',
      kind: 'service',
      binary: { win32: '', linux: '' },
      service: {},
      healthcheck: { path: 'health' },
      dependsOn: ['Bad Id'],
    },
  ]);

  assert.ok(problems.some((problem) => problem.includes('invalid format')));
  assert.ok(problems.some((problem) => problem.includes('cannot depend on itself')));
  assert.ok(problems.some((problem) => problem.includes('binary.win32')));
  assert.ok(problems.some((problem) => problem.includes('absolute "healthcheck.path"')));
});
