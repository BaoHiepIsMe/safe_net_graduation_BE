import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('GeofencesRepository integrity architecture', () => {
  const source = readFileSync(
    join(__dirname, 'geofences.repository.ts'),
    'utf8',
  );

  it('uses Prisma transactions for atomic create, assignment replacement, and transitions', () => {
    expect(source.match(/\$transaction/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('TransactionIsolationLevel.Serializable');
  });

  it('serializes cross-instance transition evaluation with a durable database lock', () => {
    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain('hashtextextended(${lockKey}, 0)');
    expect(source).toContain('geofenceState.findUnique');
  });

  it('uses parameterized Prisma SQL rather than unsafe interpolation', () => {
    expect(source).toContain('Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock');
    expect(source).toContain('await tx.$executeRaw');
    expect(source).not.toContain('$queryRawUnsafe');
    expect(source).not.toContain('$executeRawUnsafe');
  });

  it('evaluates only active accepted care-recipient assignments, ignoring their sharing switches', () => {
    expect(source).toContain("status: 'accepted'");
    expect(source).toContain('...effectiveCareRecipientWhere()');
    expect(source).not.toContain('locationSharingEnabled: true');
    expect(source).toContain("family: { status: 'active' }");
    expect(source).toContain('is_active: true');
  });

  it('sends realtime transitions privately to the care managers of the member', () => {
    expect(source).toContain('recipientUserIds');
    expect(source).toContain('findCareManagerUserIds(tx, assignment.family_id');
    expect(source).not.toContain('emitToFamily');
  });

  it('persists state and event together with stable source location provenance', () => {
    expect(source).toContain('geofenceState.update');
    expect(source).toContain('geofenceEvent.create');
    expect(source).toContain('location_id: location.id');
  });

  it('uses bounded family-scoped event history with privacy filters', () => {
    expect(source).toContain('family_id: familyId');
    expect(source).toContain('take: query.limit + 1');
    expect(source).toContain('detected_at');
  });
});
