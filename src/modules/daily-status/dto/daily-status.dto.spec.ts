import {
  dailyStatusHistoryQuerySchema,
  dailyStatusMemberParamSchema,
  dailyStatusSummarySchema,
  localDateSchema,
} from './daily-status.dto';

describe('Daily Status DTOs', () => {
  it('validates real local calendar dates and rejects invalid dates', () => {
    expect(localDateSchema.safeParse('2026-02-28').success).toBe(true);
    expect(localDateSchema.safeParse('2026-02-30').success).toBe(false);
  });

  it('strictly validates family/member parameters and pagination', () => {
    const input = {
      familyId: crypto.randomUUID(),
      memberId: crypto.randomUUID(),
      subjectUserId: crypto.randomUUID(),
    };
    expect(dailyStatusMemberParamSchema.safeParse(input).success).toBe(false);
    expect(dailyStatusHistoryQuerySchema.parse({ limit: '100' }).limit).toBe(
      100,
    );
    expect(
      dailyStatusHistoryQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
  });

  it('rejects spoofed or AI report facts from the internal summary schema', () => {
    const result = dailyStatusSummarySchema.safeParse({
      schemaVersion: 1,
      availability: {},
      riskScore: 90,
      healthStatus: 'safe',
    });
    expect(result.success).toBe(false);
  });
});
