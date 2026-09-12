import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { DailyStatusRepository } from '../src/modules/daily-status/daily-status.repository';
import { DailyStatusService } from '../src/modules/daily-status/daily-status.service';

const MANAGER = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '22222222-2222-4222-8222-222222222222';
const UNRELATED = '33333333-3333-4333-8333-333333333333';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const MEMBER = '55555555-5555-4555-8555-555555555555';

class InMemoryDailyStatusRepository {
  reports: any[] = [];
  managerCurrent = true;
  locationAllowed = true;
  noLocation = false;

  generate(
    familyId: string,
    memberId: string,
    reportDate: Date,
    timezone: string,
    dayStart: Date,
    dayEnd: Date,
  ) {
    const existing = this.reports.find(
      (item) =>
        item.familyId === familyId &&
        item.subjectUserId === SUBJECT &&
        item.reportDate.getTime() === reportDate.getTime() &&
        item.timezone === timezone,
    );
    if (existing)
      return Promise.resolve({ outcome: 'reused', report: existing });
    const locationCount = this.noLocation ? 0 : 2;
    const report = {
      id: crypto.randomUUID(),
      familyId,
      memberId,
      subjectUserId: SUBJECT,
      reportDate,
      timezone,
      dayStart,
      dayEnd,
      schemaVersion: 1,
      summary: {
        schemaVersion: 1,
        availability: {
          location: locationCount ? 'available' : 'no_data',
          geofence: 'available',
          sos: 'available',
          reminders: 'available',
          phoneUsage: 'available',
        },
        location: {
          recordCount: locationCount,
          lastRecordedAt: locationCount ? '2026-09-01T10:00:00.000Z' : null,
        },
        geofence: { enterCount: 1, exitCount: 1 },
        sos: {
          totalCount: 0,
          activeCount: 0,
          resolvedCount: 0,
          cancelledCount: 0,
        },
        reminders: {
          occurrenceCount: 2,
          notificationProcessedCount: 1,
          missedCount: 1,
        },
        phoneUsage: { totalUsageSeconds: 120, topApps: [] },
      },
      generatedAt: new Date(),
      createdAt: new Date(),
      subject: { id: SUBJECT, fullName: 'Subject B', avatarUrl: null },
      family: { status: 'active' },
      member: {
        id: MEMBER,
        userId: SUBJECT,
        role: 'child',
        status: 'accepted',
        locationSharingEnabled: this.locationAllowed,
        profile: {
          UserSetting: { locationSharingEnabled: this.locationAllowed },
        },
      },
    };
    this.reports.push(report);
    return Promise.resolve({ outcome: 'created', report });
  }

  listOwn(userId: string, query: any) {
    return Promise.resolve(
      this.reports
        .filter((item) => item.subjectUserId === userId)
        .slice(0, query.limit + 1),
    );
  }
  listMember(familyId: string, memberId: string, query: any) {
    return Promise.resolve(
      this.reports
        .filter(
          (item) => item.familyId === familyId && item.memberId === memberId,
        )
        .slice(0, query.limit + 1),
    );
  }
  findAccessReport(reportId: string) {
    const found = this.reports.find((item) => item.id === reportId);
    if (!found) return Promise.resolve(null);
    found.member.locationSharingEnabled = this.locationAllowed;
    found.member.profile.UserSetting.locationSharingEnabled =
      this.locationAllowed;
    return Promise.resolve(found);
  }
  findCurrentMembership(userId: string) {
    return Promise.resolve(
      userId === MANAGER && this.managerCurrent
        ? { role: 'manager', locationSharingEnabled: true }
        : null,
    );
  }
  findCurrentSubject(memberId: string, familyId: string) {
    return Promise.resolve(
      memberId === MEMBER && familyId === FAMILY
        ? { id: MEMBER, userId: SUBJECT, role: 'child' }
        : null,
    );
  }
  countSosNotAuthorizedForViewer() {
    return Promise.resolve(0);
  }
  listEligibleMissing() {
    return Promise.resolve([]);
  }
}

describe('Phase 14 Daily Status (e2e)', () => {
  let app: INestApplication<App>;
  let repository: InMemoryDailyStatusRepository;
  let service: DailyStatusService;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    repository = new InMemoryDailyStatusRepository();
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) =>
          Promise.resolve({
            id:
              token === 'manager'
                ? MANAGER
                : token === 'subject'
                  ? SUBJECT
                  : UNRELATED,
          }),
        ),
      })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(DailyStatusRepository)
      .useValue(repository)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    service = app.get(DailyStatusService);
  });

  it('A: generates one persisted factual report that a current manager reads', async () => {
    const generated: any = await service.generate(
      FAMILY,
      MEMBER,
      '2026-09-01',
      'Asia/Ho_Chi_Minh',
    );
    expect(generated.outcome).toBe('created');
    await request(app.getHttpServer())
      .get(`/api/v1/daily-status/${generated.report.id}`)
      .set(auth('manager'))
      .expect(200)
      .expect((response) =>
        expect(response.body.data).toMatchObject({
          reportDate: '2026-09-01',
          locationSummary: { recordCount: 2 },
          geofenceSummary: { enterCount: 1, exitCount: 1 },
          sosSummary: { totalCount: 0 },
          reminderSummary: { occurrenceCount: 2, missedCount: 1 },
        }),
      );
  });

  it('B/G: retry and concurrent scheduler-style generation remain one report', async () => {
    const before = repository.reports.length;
    const results = await Promise.all([
      service.generate(FAMILY, MEMBER, '2026-09-02', 'UTC'),
      service.generate(FAMILY, MEMBER, '2026-09-02', 'UTC'),
    ]);
    expect(repository.reports).toHaveLength(before + 1);
    const [first, second] = results;
    if (!first?.report || !second?.report) {
      throw new Error('Expected both concurrent generation results');
    }
    expect(first.report.id).toBe(second.report.id);
  });

  it('C: subject reads own report while unrelated user is denied', async () => {
    const id = repository.reports[0].id;
    await request(app.getHttpServer())
      .get(`/api/v1/daily-status/${id}`)
      .set(auth('subject'))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/daily-status/${id}`)
      .set(auth('unrelated'))
      .expect(403);
  });

  it('D: a revoked manager immediately loses historical access', async () => {
    repository.managerCurrent = false;
    await request(app.getHttpServer())
      .get(`/api/v1/daily-status/${repository.reports[0].id}`)
      .set(auth('manager'))
      .expect(403);
    repository.managerCurrent = true;
  });

  it('E: missing Location data remains no_data without a safe conclusion', async () => {
    repository.noLocation = true;
    const generated: any = await service.generate(
      FAMILY,
      MEMBER,
      '2026-09-03',
      'UTC',
    );
    await request(app.getHttpServer())
      .get(`/api/v1/daily-status/${generated.report.id}`)
      .set(auth('subject'))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.dataAvailability.location).toBe('no_data');
        expect(response.body.data.locationSummary.recordCount).toBe(0);
        expect(JSON.stringify(response.body.data)).not.toMatch(
          /healthy|safe|risk/i,
        );
      });
    repository.noLocation = false;
  });

  it('F: persisted UTC boundaries represent the configured local day', async () => {
    const generated: any = await service.generate(
      FAMILY,
      MEMBER,
      '2026-09-04',
      'Asia/Ho_Chi_Minh',
    );
    expect(generated.report.dayStart.toISOString()).toBe(
      '2026-09-03T17:00:00.000Z',
    );
    expect(generated.report.dayEnd.toISOString()).toBe(
      '2026-09-04T17:00:00.000Z',
    );
  });

  it('preserves source privacy and exposes no public metric-write endpoint', async () => {
    repository.locationAllowed = false;
    await request(app.getHttpServer())
      .get(`/api/v1/daily-status/${repository.reports[0].id}`)
      .set(auth('manager'))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.locationSummary).toBeNull();
        expect(response.body.data.geofenceSummary).toBeNull();
      });
    repository.locationAllowed = true;
    await request(app.getHttpServer())
      .post('/api/v1/daily-status')
      .set(auth('subject'))
      .send({ sosCount: 99, riskScore: 100, healthStatus: 'safe' })
      .expect(404);
  });

  afterAll(async () => app.close());
});
