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

  it('accepts an optional emergency location and rejects bad coordinates', () => {
    const base = { clientRequestId: crypto.randomUUID() };
    const parsed = triggerSosSchema.parse({
      ...base,
      location: {
        latitude: 21.03,
        longitude: 105.85,
        recordedAt: '2026-11-16T08:00:00+07:00',
      },
    });
    expect(parsed.location?.recordedAt).toBeInstanceOf(Date);
    for (const location of [
      { latitude: 91, longitude: 0, recordedAt: '2026-11-16T08:00:00Z' },
      { latitude: 0, longitude: 181, recordedAt: '2026-11-16T08:00:00Z' },
      {
        latitude: 0,
        longitude: 0,
        accuracy: -1,
        recordedAt: '2026-11-16T08:00:00Z',
      },
      { latitude: 0, longitude: 0 },
      {
        latitude: 0,
        longitude: 0,
        recordedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      {
        latitude: 0,
        longitude: 0,
        recordedAt: '2026-11-16T08:00:00Z',
        userId: 'spoofed',
      },
    ]) {
      expect(() => triggerSosSchema.parse({ ...base, location })).toThrow();
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
