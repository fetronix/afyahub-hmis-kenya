import { describe, expect, it } from 'vitest';
import { parseApprovedProtocol, validateProtocolValues } from '../../dialysis/dialysis.service.ts';

describe('facility-defined dialysis protocol validation', () => {
  const protocol = parseApprovedProtocol(
    {
      version: 'TEST-1',
      approvalReference: 'Synthetic test approval',
      planFields: [{ key: 'example', type: 'number', required: true, min: 1, max: 5 }],
      completionFields: [{ key: 'note', type: 'text', required: true }],
    },
    9,
    new Date('2026-01-01T00:00:00Z'),
  );
  it('uses only explicitly supplied rules and values', () => {
    expect(validateProtocolValues(protocol.planFields, { example: 3 })).toEqual({ example: 3 });
    expect(() => validateProtocolValues(protocol.planFields, {})).toThrow();
    expect(() => validateProtocolValues(protocol.planFields, { example: 6 })).toThrow();
    expect(() => validateProtocolValues(protocol.planFields, { example: 3, unknown: 1 })).toThrow();
    expect(protocol.approvedByUserId).toBe(9);
  });
  it('rejects missing approval, malformed rules and inferred defaults', () => {
    expect(() => parseApprovedProtocol({}, 1)).toThrow();
    expect(() =>
      parseApprovedProtocol(
        {
          version: '1',
          approvalReference: 'Test',
          planFields: [{ key: 'x', type: 'number', required: true, min: 9, max: 1 }],
          completionFields: [],
        },
        1,
      ),
    ).toThrow();
    expect(() => validateProtocolValues(protocol.completionFields, { note: ' ' })).toThrow();
  });
});
