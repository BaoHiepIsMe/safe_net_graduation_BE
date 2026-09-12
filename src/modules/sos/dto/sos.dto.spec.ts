import {
  createSosContactSchema,
  emptySosTransitionSchema,
  sosHistoryQuerySchema,
  triggerSosSchema,
  updateSosContactSchema,
} from './sos.dto';

describe('Phase 7 SOS DTO validation', () => {
  it('accepts a minimal manual SOS and normalizes contact phones', () => {
    expect(
      triggerSosSchema.parse({ clientRequestId: crypto.randomUUID() }),
    ).toEqual({ clientRequestId: expect.any(String) });
    expect(
      createSosContactSchema.parse({
        contactName: 'Parent',
        phone: '+84 (912) 345-678',
      }).phone,
    ).toBe('+84912345678');
  });

  it('rejects spoofed actor, recipients, status, source and timestamps', () => {
    const base = { clientRequestId: crypto.randomUUID() };
    for (const field of [
      'userId',
      'actorId',
      'recipientIds',
      'status',
      'source',
      'triggeredAt',
    ]) {
      expect(() =>
        triggerSosSchema.parse({ ...base, [field]: 'spoofed' }),
      ).toThrow();
    }
  });

  it('bounds message, pagination and supported status filters', () => {
    expect(() =>
      triggerSosSchema.parse({
        clientRequestId: crypto.randomUUID(),
        message: 'x'.repeat(501),
      }),
    ).toThrow();
    expect(() => sosHistoryQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => sosHistoryQuerySchema.parse({ status: 'handled' })).toThrow();
  });

  it('rejects invalid contacts and client ownership fields', () => {
    expect(() =>
      createSosContactSchema.parse({ contactName: '', phone: '123' }),
    ).toThrow();
    expect(() =>
      createSosContactSchema.parse({
        contactName: 'A',
        phone: '+84912345678',
        ownerUserId: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(() => updateSosContactSchema.parse({})).toThrow();
  });

  it('requires strict empty transition bodies', () => {
    expect(emptySosTransitionSchema.parse({})).toEqual({});
    expect(() =>
      emptySosTransitionSchema.parse({ status: 'resolved' }),
    ).toThrow();
  });
});
