import {
  commandAckSchema,
  commandListQuerySchema,
  createPhoneCommandSchema,
  createPhoneRuleSchema,
  phoneUsageSchema,
  updatePhoneRuleSchema,
  usageListQuerySchema,
} from './phone-management.dto';

const id = '11111111-1111-4111-8111-111111111111';

describe('Phone Management DTO validation', () => {
  it('accepts bounded device usage with stable idempotency identity', () => {
    expect(
      phoneUsageSchema.parse({
        clientRecordId: id,
        appPackage: 'com.example.safe',
        appName: 'Safe app',
        startedAt: '2030-01-01T00:00:00Z',
        endedAt: '2030-01-01T00:10:00Z',
        durationSeconds: 600,
      }),
    ).toBeDefined();
  });

  it('rejects invalid windows, duration, ownership and unknown fields', () => {
    expect(
      phoneUsageSchema.safeParse({
        clientRecordId: id,
        appPackage: 'com.example.app',
        startedAt: '2030-01-01T01:00:00Z',
        endedAt: '2030-01-01T00:00:00Z',
        durationSeconds: -1,
        userId: id,
      }).success,
    ).toBe(false);
  });

  it('validates daily limits and paired bedtime intent', () => {
    expect(
      createPhoneRuleSchema.safeParse({
        dailyLimitMinutes: 120,
        bedtimeStart: '21:30',
        bedtimeEnd: '06:30',
      }).success,
    ).toBe(true);
    expect(
      createPhoneRuleSchema.safeParse({ bedtimeStart: '21:30' }).success,
    ).toBe(false);
    expect(createPhoneRuleSchema.safeParse({}).success).toBe(false);
    expect(updatePhoneRuleSchema.safeParse({}).success).toBe(false);
  });

  it('only supports structured lock/unlock/ring/warning commands', () => {
    expect(
      createPhoneCommandSchema.safeParse({
        clientRequestId: id,
        commandType: 'unlock',
      }).success,
    ).toBe(true);
    expect(
      createPhoneCommandSchema.safeParse({
        clientRequestId: id,
        commandType: 'wipe',
      }).success,
    ).toBe(false);
    expect(
      createPhoneCommandSchema.safeParse({
        clientRequestId: id,
        commandType: 'warning',
        message: 'Please take a break',
      }).success,
    ).toBe(true);
    expect(
      createPhoneCommandSchema.safeParse({
        clientRequestId: id,
        commandType: 'lock',
        completed: true,
      }).success,
    ).toBe(false);
    expect(
      createPhoneCommandSchema.safeParse({
        clientRequestId: id,
        commandType: 'warning',
      }).success,
    ).toBe(false);
  });

  it('allows only controlled terminal Device ACK results', () => {
    expect(commandAckSchema.safeParse({ status: 'completed' }).success).toBe(
      true,
    );
    expect(
      commandAckSchema.safeParse({
        status: 'failed',
        resultCode: 'UNSUPPORTED',
      }).success,
    ).toBe(true);
    expect(commandAckSchema.safeParse({ status: 'sent' }).success).toBe(false);
    expect(
      commandAckSchema.safeParse({ status: 'completed', stackTrace: 'secret' })
        .success,
    ).toBe(false);
  });

  it('bounds cursor histories and date ranges', () => {
    expect(commandListQuerySchema.parse({})).toEqual({
      limit: 20,
      status: 'all',
    });
    expect(usageListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      usageListQuerySchema.safeParse({
        from: '2030-01-01T00:00:00Z',
        to: '2030-03-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
