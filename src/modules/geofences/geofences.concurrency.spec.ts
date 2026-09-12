import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { GeofencesRepository } from './geofences.repository';

const FAMILY = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const ZONE = '44444444-4444-4444-8444-444444444444';

class FakeSerializedPrisma {
  private locked = false;
  private waiters: Array<() => void> = [];
  state: any = null;
  events: any[] = [];

  private async acquire() {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.locked = false;
  }

  async $transaction(work: (tx: any) => Promise<any>) {
    let acquired = false;
    const tx = {
      geofenceMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            family_id: FAMILY,
            member_id: MEMBER,
            notify_on_enter: true,
            notify_on_exit: true,
            Geofence: {
              id: ZONE,
              name: 'Home',
              center_latitude: new Prisma.Decimal(0),
              center_longitude: new Prisma.Decimal(0),
              radius_meters: 100,
            },
          },
        ]),
      },
      $executeRaw: async () => {
        await this.acquire();
        acquired = true;
        return [];
      },
      geofenceState: {
        findUnique: () => Promise.resolve(this.state),
        create: ({ data }: any) => {
          this.state = { id: '55555555-5555-4555-8555-555555555555', ...data };
          return Promise.resolve(this.state);
        },
        update: ({ data }: any) => {
          this.state = { ...this.state, ...data };
          return Promise.resolve(this.state);
        },
      },
      geofenceEvent: {
        create: ({ data }: any) => {
          const event = {
            id: `66666666-6666-4666-8666-66666666666${this.events.length}`,
            detected_at: data.detected_at,
            ...data,
          };
          this.events.push(event);
          return Promise.resolve(event);
        },
      },
      familyMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: USER }]),
      },
    };
    try {
      return await work(tx);
    } finally {
      if (acquired) this.release();
    }
  }
}

describe('GeofencesRepository concurrent transition evaluation', () => {
  const point = (id: string, longitude: number, recordedAt: string) => ({
    id,
    userId: USER,
    latitude: 0,
    longitude,
    recordedAt: new Date(recordedAt),
  });

  it('creates at most one logical ENTER and one logical EXIT under concurrency', async () => {
    const prisma = new FakeSerializedPrisma();
    const repository = new GeofencesRepository(
      prisma as unknown as PrismaService,
    );
    await repository.evaluateCommittedLocation(
      point(
        '77777777-7777-4777-8777-777777777770',
        0.002,
        '2026-08-24T00:00:00Z',
      ),
    );

    await Promise.all([
      repository.evaluateCommittedLocation(
        point(
          '77777777-7777-4777-8777-777777777771',
          0,
          '2026-08-24T00:00:01Z',
        ),
      ),
      repository.evaluateCommittedLocation(
        point(
          '77777777-7777-4777-8777-777777777772',
          0,
          '2026-08-24T00:00:02Z',
        ),
      ),
    ]);
    expect(
      prisma.events.filter((event) => event.event_type === 'enter'),
    ).toHaveLength(1);

    await Promise.all([
      repository.evaluateCommittedLocation(
        point(
          '77777777-7777-4777-8777-777777777773',
          0.002,
          '2026-08-24T00:00:03Z',
        ),
      ),
      repository.evaluateCommittedLocation(
        point(
          '77777777-7777-4777-8777-777777777774',
          0.002,
          '2026-08-24T00:00:04Z',
        ),
      ),
    ]);
    expect(
      prisma.events.filter((event) => event.event_type === 'exit'),
    ).toHaveLength(1);
  });
});
