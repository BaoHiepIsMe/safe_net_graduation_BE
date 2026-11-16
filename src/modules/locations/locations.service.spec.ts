import { Prisma } from '../../generated/prisma/client';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { FamilyAccessService } from '../families/family-access.service';
import { GeofenceEvaluationService } from '../geofences/geofence-evaluation.service';
import { LOCATION_EVENT_NAME } from './locations.constants';
import { LocationsRepository } from './locations.repository';
import { LocationsService } from './locations.service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const FAMILY_ID = '55555555-5555-4555-8555-555555555555';
const MEMBER_ID = '66666666-6666-4666-8666-666666666666';
const recordedAt = new Date('2026-08-24T04:00:00.000Z');
const location = {
  id: LOCATION_ID,
  latitude: new Prisma.Decimal(10.7),
  longitude: new Prisma.Decimal(106.6),
  accuracy: 5,
  speed: 0,
  heading: 90,
  batteryLevel: 80,
  recordedAt,
  createdAt: new Date('2026-08-24T04:00:01.000Z'),
};

function setup() {
  const repository = {
    ingest: jest.fn(),
    findOwnCurrent: jest.fn(),
    listHistory: jest.fn(),
    findHistoryTarget: jest.fn(),
    findFamilyCurrentLocations: jest.fn(),
    findFamilyMemberCurrentLocation: jest.fn(),
  };
  const access = { requireAcceptedMember: jest.fn().mockResolvedValue({}) };
  const realtime = { emitToUser: jest.fn() };
  const geofenceEvaluation = {
    evaluateCommittedLocation: jest.fn().mockResolvedValue([]),
  };
  return {
    repository,
    access,
    realtime,
    geofenceEvaluation,
    service: new LocationsService(
      repository as unknown as LocationsRepository,
      access as unknown as FamilyAccessService,
      realtime as unknown as RealtimeGateway,
      geofenceEvaluation as unknown as GeofenceEvaluationService,
    ),
  };
}

describe('LocationsService', () => {
  it('emits a safe event only after the persistence transaction resolves', async () => {
    const { service, repository, realtime } = setup();
    let commit: ((value: unknown) => void) | undefined;
    repository.ingest.mockReturnValue(
      new Promise((resolve) => {
        commit = resolve;
      }),
    );
    const pending = service.ingest(USER_A, DEVICE_ID, {
      latitude: 10.7,
      longitude: 106.6,
      recordedAt,
    });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
    commit?.({
      outcome: 'stored',
      history: location,
      currentUpdated: true,
      recipientUserIds: [USER_B],
    });
    await pending;
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      USER_B,
      LOCATION_EVENT_NAME,
      expect.not.objectContaining({
        fcmToken: expect.anything(),
        installationId: expect.anything(),
        deviceId: expect.anything(),
      }),
    );
  });

  it('emits nothing when the transaction fails or a stale point is stored', async () => {
    const { service, repository, realtime } = setup();
    repository.ingest.mockRejectedValueOnce(new Error('rollback'));
    await expect(
      service.ingest(USER_A, DEVICE_ID, {
        latitude: 10.7,
        longitude: 106.6,
        recordedAt,
      }),
    ).rejects.toThrow('rollback');
    repository.ingest.mockResolvedValueOnce({
      outcome: 'stored',
      history: location,
      currentUpdated: false,
      recipientUserIds: [],
    });
    await service.ingest(USER_A, DEVICE_ID, {
      latitude: 10.7,
      longitude: 106.6,
      recordedAt,
    });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('keeps the committed location successful when realtime delivery fails', async () => {
    const { service, repository, realtime } = setup();
    repository.ingest.mockResolvedValue({
      outcome: 'stored',
      history: location,
      currentUpdated: true,
      recipientUserIds: [USER_B],
    });
    realtime.emitToUser.mockImplementation(() => {
      throw new Error('socket unavailable');
    });

    await expect(
      service.ingest(USER_A, DEVICE_ID, {
        latitude: 10.7,
        longitude: 106.6,
        recordedAt,
      }),
    ).resolves.toMatchObject({ id: LOCATION_ID, currentUpdated: true });
    expect(repository.ingest).toHaveBeenCalledTimes(1);
  });

  it('hides foreign devices and rejects inactive devices', async () => {
    const { service, repository } = setup();
    repository.ingest.mockResolvedValueOnce({ outcome: 'not_found' });
    await expect(
      service.ingest(USER_B, DEVICE_ID, {
        latitude: 10.7,
        longitude: 106.6,
        recordedAt,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    repository.ingest.mockResolvedValueOnce({ outcome: 'inactive' });
    await expect(
      service.ingest(USER_A, DEVICE_ID, {
        latitude: 10.7,
        longitude: 106.6,
        recordedAt,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('returns own current location and handles the no-location case', async () => {
    const { service, repository } = setup();
    repository.findOwnCurrent.mockResolvedValueOnce({
      latitude: new Prisma.Decimal(10.7),
      longitude: new Prisma.Decimal(106.6),
      accuracy: null,
      batteryLevel: null,
      recordedAt,
      updatedAt: new Date(),
    });
    await expect(service.getOwnCurrent(USER_A)).resolves.toMatchObject({
      latitude: 10.7,
      longitude: 106.6,
    });
    repository.findOwnCurrent.mockResolvedValueOnce(null);
    await expect(service.getOwnCurrent(USER_A)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('returns bounded deterministic cursor history without secrets', async () => {
    const { service, repository } = setup();
    repository.listHistory.mockResolvedValue([
      location,
      { ...location, id: '77777777-7777-4777-8777-777777777777' },
    ]);
    const result = await service.getOwnHistory(USER_A, { limit: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.pagination).toMatchObject({ hasMore: true, limit: 1 });
    expect(result.pagination.nextCursor).toEqual(expect.any(String));
    expect(result.data[0]).not.toHaveProperty('deviceId');
  });

  it('rejects malformed opaque cursors', async () => {
    const { service } = setup();
    await expect(
      service.getOwnHistory(USER_A, { limit: 20, cursor: 'invalid' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires accepted family access before returning family map data', async () => {
    const { service, repository, access } = setup();
    repository.findFamilyCurrentLocations.mockResolvedValue([]);
    await service.getFamilyCurrent(USER_A, FAMILY_ID);
    expect(access.requireAcceptedMember).toHaveBeenCalledWith(
      USER_A,
      FAMILY_ID,
    );

    access.requireAcceptedMember.mockRejectedValueOnce(new ForbiddenError());
    await expect(
      service.getFamilyCurrent(USER_B, FAMILY_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('passes both family and member IDs to the scoped member-location query', async () => {
    const { service, repository } = setup();
    repository.findFamilyMemberCurrentLocation.mockResolvedValue(null);
    await expect(
      service.getFamilyMemberCurrent(USER_A, FAMILY_ID, MEMBER_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(repository.findFamilyMemberCurrentLocation).toHaveBeenCalledWith(
      FAMILY_ID,
      MEMBER_ID,
    );
  });

  it('passes from/to through for own history and keeps old behaviour without them', async () => {
    const { service, repository } = setup();
    repository.listHistory.mockResolvedValue([]);
    await service.getOwnHistory(USER_A, { limit: 50 });
    expect(repository.listHistory).toHaveBeenLastCalledWith(
      USER_A,
      { limit: 50 },
      undefined,
      { from: undefined, to: undefined },
    );
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-02T00:00:00Z');
    await service.getOwnHistory(USER_A, { limit: 50, from, to });
    expect(repository.listHistory.mock.calls[1][3]).toEqual({ from, to });
  });

  describe('getFamilyMemberHistory', () => {
    const query = { limit: 50 };

    it('returns the target history for an accepted viewer, newest first', async () => {
      const { service, repository, access } = setup();
      repository.findHistoryTarget.mockResolvedValue({
        userId: USER_B,
        sharing: true,
      });
      repository.listHistory.mockResolvedValue([location]);
      const result = await service.getFamilyMemberHistory(
        USER_A,
        FAMILY_ID,
        MEMBER_ID,
        query,
      );
      expect(access.requireAcceptedMember).toHaveBeenCalledWith(
        USER_A,
        FAMILY_ID,
      );
      expect(repository.findHistoryTarget).toHaveBeenCalledWith(
        FAMILY_ID,
        MEMBER_ID,
      );
      expect(repository.listHistory.mock.calls[0][0]).toBe(USER_B);
      expect(result.data).toHaveLength(1);
      expect(result.pagination).toMatchObject({ hasMore: false, limit: 50 });
    });

    it('rejects outsiders before touching data', async () => {
      const { service, repository, access } = setup();
      access.requireAcceptedMember.mockRejectedValueOnce(new ForbiddenError());
      await expect(
        service.getFamilyMemberHistory(USER_B, FAMILY_ID, MEMBER_ID, query),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(repository.findHistoryTarget).not.toHaveBeenCalled();
    });

    it('returns 404 for unknown members and for members with sharing off', async () => {
      const { service, repository } = setup();
      repository.findHistoryTarget.mockResolvedValueOnce(null);
      await expect(
        service.getFamilyMemberHistory(USER_A, FAMILY_ID, MEMBER_ID, query),
      ).rejects.toBeInstanceOf(NotFoundError);
      repository.findHistoryTarget.mockResolvedValueOnce({
        userId: USER_B,
        sharing: false,
      });
      await expect(
        service.getFamilyMemberHistory(USER_A, FAMILY_ID, MEMBER_ID, query),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(repository.listHistory).not.toHaveBeenCalled();
    });

    it('lets users read their own history even when sharing is off', async () => {
      const { service, repository } = setup();
      repository.findHistoryTarget.mockResolvedValue({
        userId: USER_A,
        sharing: false,
      });
      repository.listHistory.mockResolvedValue([]);
      await expect(
        service.getFamilyMemberHistory(USER_A, FAMILY_ID, MEMBER_ID, query),
      ).resolves.toMatchObject({ data: [] });
      expect(repository.listHistory.mock.calls[0][0]).toBe(USER_A);
    });

    it('clamps from to the last 7 days', async () => {
      const { service, repository } = setup();
      repository.findHistoryTarget.mockResolvedValue({
        userId: USER_B,
        sharing: true,
      });
      repository.listHistory.mockResolvedValue([]);
      const before = Date.now();
      await service.getFamilyMemberHistory(USER_A, FAMILY_ID, MEMBER_ID, {
        limit: 50,
        from: new Date(before - 30 * 24 * 60 * 60 * 1000),
      });
      const { from } = repository.listHistory.mock.calls[0][3] as {
        from: Date;
      };
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(Date.now() - from.getTime() - sevenDays)).toBeLessThan(
        5000,
      );
      const recent = new Date(before - 60 * 60 * 1000);
      await service.getFamilyMemberHistory(USER_A, FAMILY_ID, MEMBER_ID, {
        limit: 50,
        from: recent,
      });
      expect(repository.listHistory.mock.calls[1][3]).toMatchObject({
        from: recent,
      });
    });
  });
});
