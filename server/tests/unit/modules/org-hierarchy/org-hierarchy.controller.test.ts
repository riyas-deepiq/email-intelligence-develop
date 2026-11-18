import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseAddBody,
  parseUpdateBody,
  parseManagers,
  uuid,
} from '../../../../src/modules/org-hierarchy/org-hierarchy.controller';
describe('hierarchy validation', () => {
  it('normalizes IDs and allows vacant positions', () => {
    const id = randomUUID();
    expect(uuid(' ' + id.toUpperCase() + ' ')).toBe(id);
    expect(parseAddBody({ title: ' CEO ' })).toEqual({
      title: 'CEO',
      managerNodeIds: [],
      userId: null,
    });
    expect(parseAddBody({ title: 'Engineer', managerNodeIds: [id], userId: null })).toMatchObject({
      managerNodeIds: [id],
      userId: null,
    });
    expect(parseUpdateBody({ department: null })).toEqual({ department: null });
  });
  it.each([null, undefined, '', 'not-a-uuid', 42, {}, [], '12345678-1234-1234-1234-12345678901z'])(
    'rejects malformed UUID %s',
    (value) => {
      expect(() => uuid(value)).toThrow('UUID');
    },
  );
  it.each([
    {},
    null,
    [],
    { title: '' },
    { title: null },
    { title: 'x'.repeat(201) },
    { department: 42 },
    { sortOrder: 1.1 },
    { sortOrder: 2147483648 },
    { userId: null },
  ])('rejects invalid position patch %s', (value) => {
    expect(() => parseUpdateBody(value)).toThrow();
  });
  it('rejects malformed and normalized duplicate managers', () => {
    const id = randomUUID();
    for (const ids of [null, {}, 'x', [null], ['bad'], [id, id.toUpperCase()]])
      expect(() => parseManagers(ids)).toThrow();
    expect(parseManagers([])).toEqual([]);
  });
  it('rejects invalid IDs during create', () => {
    expect(() => parseAddBody({ title: 'X', managerNodeIds: null })).toThrow('array');
    expect(() => parseAddBody({ title: 'X', userId: 'bad' })).toThrow('UUID');
    expect(() => parseAddBody({ title: 'X', managerNodeIds: ['bad'] })).toThrow('UUID');
    expect(() => parseAddBody({ department: 'X' })).toThrow('Title');
  });
});
