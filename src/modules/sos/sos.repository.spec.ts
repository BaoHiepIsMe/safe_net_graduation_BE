import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SosRepository } from './sos.repository';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const RECIPIENT = '22222222-2222-4222-8222-222222222222';
const PENDING = '33333333-3333-4333-8333-333333333333';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const MEMBER = '55555555-5555-4555-8555-555555555555';
const EVENT = '66666666-6666-4666-8666-666666666666';
const REQUEST = '77777777-7777-4777-8777-777777777777';
const LOCATION = '88888888-8888-4888-8888-888888888888';
const FINGERPRINT = 'a'.repeat(64);

describe('SosRepository critical persistence', () => {
  function setup(
    options: {
      location?: any;
      existing?: any;
      active?: any;
      device?: any;
    } = {},
  ) {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      sosEvent: {
        findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
        findFirst: jest.fn().mockResolvedValue(options.active ?? null),
        create: jest.fn(),
        update: jest.fn(),
      },
      device: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            'device' in options ? options.device : { id: crypto.randomUUID() },
          ),
      },
      currentLocation: {
        findUnique: jest.fn().mockResolvedValue(
          'location' in options
            ? options.location
            : {
                locationId: LOCATION,
                latitude: 10.7,
                longitude: 106.6,
                accuracy: 4,
                recordedAt: new Date('2026-08-31T00:00:00Z'),
              },
        ),
      },
      familyMember: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: MEMBER, familyId: FAMILY }])
          .mockResolvedValueOnce([{ userId: ACTOR }, { userId: RECIPIENT }]),
        findFirst: jest.fn().mockResolvedValue({ id: MEMBER }),
      },
      sosContact: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { contactUserId: RECIPIENT },
            { contactUserId: PENDING },
            { contactUserId: null },
          ]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    tx.sosEvent.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: EVENT,
        actorUserId: data.actorUserId,
        clientRequestId: data.clientRequestId,
        status: 'active',
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        locationAccuracy: data.locationAccuracy ?? null,
        locationRecordedAt: data.locationRecordedAt ?? null,
        note: data.note ?? null,
        triggeredAt: new Date(),
        resolvedAt: null,
        cancelledAt: null,
        actor: { id: ACTOR, fullName: 'Actor', avatarUrl: null },
        recipients: data.recipients.create.map((item: any) => ({
          recipientUserId: item.recipientUserId,
        })),
      }),
    );
    const prisma = {
      $transaction: jest.fn((work: (client: any) => unknown) => work(tx)),
      sosContact: {
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      sosEvent: { findMany: jest.fn(), findFirst: jest.fn() },
    };
    return {
      tx,
      prisma,
      repository: new SosRepository(prisma as unknown as PrismaService),
    };
  }

  it('prefers the phone emergency location and does not link history', async () => {
    const { tx, repository } = setup();
    const recordedAt = new Date('2026-11-16T08:00:00Z');
    const result = await repository.trigger(
      ACTOR,
      {
        clientRequestId: REQUEST,
        location: {
          latitude: 21.03,
          longitude: 105.85,
          accuracy: 12,
          recordedAt,
        },
      },
      FINGERPRINT,
    );
    expect(result.outcome).toBe('created');
    expect(tx.currentLocation.findUnique).not.toHaveBeenCalled();
    const data = tx.sosEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      latitude: 21.03,
      longitude: 105.85,
      locationAccuracy: 12,
      locationRecordedAt: recordedAt,
    });
    expect(data).not.toHaveProperty('sourceLocationId');
  });

  it('stores a null accuracy when the phone omits it', async () => {
    const { tx, repository } = setup();
    await repository.trigger(
      ACTOR,
      {
        clientRequestId: REQUEST,
        location: {
          latitude: 21.03,
          longitude: 105.85,
          recordedAt: new Date('2026-11-16T08:00:00Z'),
        },
      },
      FINGERPRINT,
    );
    expect(tx.sosEvent.create.mock.calls[0][0].data.locationAccuracy).toBe(
      null,
    );
  });

  it('snapshots current location and resolves only accepted active-family recipients', async () => {
    const { tx, repository } = setup();
    const result = await repository.trigger(
      ACTOR,
      { clientRequestId: REQUEST, message: 'Help' },
      FINGERPRINT,
    );
    expect(result.outcome).toBe('created');
    expect(tx.familyMember.findMany.mock.calls[1][0].where).toEqual({
      familyId: { in: [FAMILY] },
      status: 'accepted',
      family: { status: 'active' },
    });
    const data = tx.sosEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      actorUserId: ACTOR,
      sourceLocationId: LOCATION,
      latitude: 10.7,
      longitude: 106.6,
      locationAccuracy: 4,
    });
    expect(data.recipients.create).toEqual(
      expect.arrayContaining([
        { recipientUserId: ACTOR, source: 'actor' },
        { recipientUserId: RECIPIENT, source: 'emergency_contact' },
      ]),
    );
    expect(data.recipients.create).not.toEqual(
      expect.arrayContaining([
        { recipientUserId: PENDING, source: expect.any(String) },
      ]),
    );
  });

  it('still persists without a current location', async () => {
    const { tx, repository } = setup({ location: null });
    await expect(
      repository.trigger(ACTOR, { clientRequestId: REQUEST }, FINGERPRINT),
    ).resolves.toMatchObject({ outcome: 'created' });
    expect(tx.sosEvent.create.mock.calls[0][0].data).toMatchObject({
      sourceLocationId: undefined,
      latitude: undefined,
      longitude: undefined,
    });
  });

  it('reuses matching idempotency and rejects conflicting reuse before new writes', async () => {
    const matching = setup({
      existing: { requestFingerprint: FINGERPRINT, id: EVENT },
    });
    await expect(
      matching.repository.trigger(
        ACTOR,
        { clientRequestId: REQUEST },
        FINGERPRINT,
      ),
    ).resolves.toMatchObject({ outcome: 'reused' });
    expect(matching.tx.sosEvent.create).not.toHaveBeenCalled();

    const conflict = setup({
      existing: { requestFingerprint: 'b'.repeat(64), id: EVENT },
    });
    await expect(
      conflict.repository.trigger(
        ACTOR,
        { clientRequestId: REQUEST },
        FINGERPRINT,
      ),
    ).resolves.toEqual({ outcome: 'idempotency_conflict' });
  });

  it('rejects a foreign or inactive supplied device without blocking device-less SOS', async () => {
    const denied = setup({ device: null });
    await expect(
      denied.repository.trigger(
        ACTOR,
        { clientRequestId: REQUEST, deviceId: crypto.randomUUID() },
        FINGERPRINT,
      ),
    ).resolves.toEqual({ outcome: 'invalid_device' });
    expect(denied.tx.sosEvent.create).not.toHaveBeenCalled();
  });

  it('uses an actor advisory lock and DB-backed active-incident check', async () => {
    const { tx, repository } = setup({ active: { id: EVENT } });
    await expect(
      repository.trigger(ACTOR, { clientRequestId: REQUEST }, FINGERPRINT),
    ).resolves.toEqual({ outcome: 'already_active', eventId: EVENT });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.sosEvent.create).not.toHaveBeenCalled();
  });

  it('scopes contact mutation and deletion by the authenticated owner', async () => {
    const { tx, prisma, repository } = setup();
    tx.sosContact.create.mockResolvedValue({ id: crypto.randomUUID() });
    await repository.createContact(ACTOR, {
      contactName: 'Parent',
      phone: '+84912345678',
      priority: 1,
    });
    expect(tx.sosContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerUserId: ACTOR }),
      }),
    );
    prisma.sosContact.deleteMany.mockResolvedValue({ count: 0 });
    await repository.deleteContact(ACTOR, crypto.randomUUID());
    expect(prisma.sosContact.deleteMany).toHaveBeenCalledWith({
      where: { id: expect.any(String), ownerUserId: ACTOR },
    });
  });
});
