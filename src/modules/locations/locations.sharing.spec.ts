import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationError } from '../../common/errors/app.error';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { updateUserSettingsSchema } from '../profiles/dto/profile.dto';
import { setLocationViewersSchema } from './dto/location.dto';
import { LocationsRepository } from './locations.repository';
import { LocationsService } from './locations.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const PEER_A = '22222222-2222-4222-8222-222222222222';
const PEER_B = '33333333-3333-4333-8333-333333333333';
const STRANGER = '44444444-4444-4444-8444-444444444444';
const FAMILY_ID = '55555555-5555-4555-8555-555555555555';

function serviceWith(repository: Record<string, jest.Mock>) {
  return new LocationsService(
    repository as unknown as LocationsRepository,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('location sharing controls', () => {
  describe('viewer list', () => {
    it('stores viewers who share a family with the owner', async () => {
      const repository = {
        findFamilyPeerUserIds: jest.fn().mockResolvedValue([PEER_A, PEER_B]),
        replaceViewers: jest.fn().mockResolvedValue(undefined),
      };
      await expect(
        serviceWith(repository).setViewers(OWNER, [PEER_A]),
      ).resolves.toEqual({ viewerUserIds: [PEER_A] });
      expect(repository.replaceViewers).toHaveBeenCalledWith(OWNER, [PEER_A]);
    });

    it('rejects someone outside the owner families without saving', async () => {
      const repository = {
        findFamilyPeerUserIds: jest.fn().mockResolvedValue([PEER_A]),
        replaceViewers: jest.fn(),
      };
      await expect(
        serviceWith(repository).setViewers(OWNER, [PEER_A, STRANGER]),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(repository.replaceViewers).not.toHaveBeenCalled();
    });

    it('allows clearing the list', async () => {
      const repository = {
        findFamilyPeerUserIds: jest.fn().mockResolvedValue([]),
        replaceViewers: jest.fn().mockResolvedValue(undefined),
      };
      await expect(
        serviceWith(repository).setViewers(OWNER, []),
      ).resolves.toEqual({ viewerUserIds: [] });
    });

    it('rejects duplicates and non-uuid ids', () => {
      expect(
        setLocationViewersSchema.safeParse({ viewerUserIds: [PEER_A, PEER_A] })
          .success,
      ).toBe(false);
      expect(
        setLocationViewersSchema.safeParse({ viewerUserIds: ['x'] }).success,
      ).toBe(false);
      expect(
        setLocationViewersSchema.safeParse({ viewerUserIds: [PEER_A] }).success,
      ).toBe(true);
    });
  });

  describe('family current location visibility', () => {
    async function captureSql() {
      const queryRaw = jest.fn().mockResolvedValue([]);
      const prisma = { $queryRaw: queryRaw };
      await new LocationsRepository(
        prisma as unknown as PrismaService,
      ).findFamilyCurrentLocations(FAMILY_ID, PEER_A);
      return (queryRaw.mock.calls[0][0] as { sql: string }).sql;
    }

    it('lets a care recipient (flag or minor) bypass their own sharing switches', async () => {
      const sql = await captureSql();
      expect(sql).toContain('fm."is_care_recipient" = true');
      expect(sql).toContain('p."date_of_birth" >');
    });

    it('keeps sharing switches and the selected viewer list for everyone else', async () => {
      const sql = await captureSql();
      expect(sql).toContain('fm."location_sharing_enabled" = true');
      expect(sql).toContain('us."location_sharing_enabled" = true');
      expect(sql).toContain(`us."location_visibility" = 'all'`);
      expect(sql).toContain('"location_share_viewers"');
    });

    it('limits a hired non-owner caregiver to members in their care scope', async () => {
      const sql = await captureSql();
      expect(sql).toContain('viewer."is_hired" = true');
      expect(sql).toContain('"family_member_care_scopes"');
    });
  });

  describe('settings', () => {
    it('accepts the new sharing settings and rejects unknown values', () => {
      expect(
        updateUserSettingsSchema.safeParse({
          sharingMode: 'battery_saver',
          locationVisibility: 'selected',
          notifyOnZoneExit: false,
        }).success,
      ).toBe(true);
      expect(
        updateUserSettingsSchema.safeParse({ sharingMode: 'turbo' }).success,
      ).toBe(false);
      expect(
        updateUserSettingsSchema.safeParse({ locationVisibility: 'nobody' })
          .success,
      ).toBe(false);
    });
  });

  describe('migration', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma',
        'migrations',
        '20261118100000_location_sharing_controls',
        'migration.sql',
      ),
      'utf8',
    );

    it('adds defaults that keep today behaviour', () => {
      expect(sql).toContain(
        '"sharing_mode" VARCHAR(20) NOT NULL DEFAULT \'continuous\'',
      );
      expect(sql).toContain(
        '"location_visibility" VARCHAR(20) NOT NULL DEFAULT \'all\'',
      );
      expect(sql).toContain(
        '"notify_on_zone_exit" BOOLEAN NOT NULL DEFAULT true',
      );
    });

    it('creates a locked-down viewer table', () => {
      expect(sql).toContain('CREATE TABLE "public"."location_share_viewers"');
      expect(sql).toContain('location_share_viewers_not_self');
      expect(sql).toContain('FORCE ROW LEVEL SECURITY');
      expect(sql).toContain('FROM anon, authenticated');
    });
  });
});
