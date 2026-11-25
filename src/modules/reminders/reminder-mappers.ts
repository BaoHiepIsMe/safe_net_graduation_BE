import { storedScheduleToDto } from './reminder-schedule';

type MemberRow = {
  userId: string;
  displayName: string | null;
  profile: { fullName: string | null; avatarUrl?: string | null };
};

export const memberDisplayName = (member: MemberRow) =>
  member.displayName ?? member.profile.fullName ?? null;

export function mapReminder(row: any) {
  return {
    id: row.id,
    familyId: row.familyId,
    creator: {
      id: row.creator.id,
      fullName: row.creator.fullName,
      avatarUrl: row.creator.avatarUrl,
    },
    title: row.title,
    description: row.description,
    reminderType: row.reminderType,
    priority: row.priority,
    schedule: storedScheduleToDto(row),
    isActive: row.isActive,
    nextOccurrenceAt: row.nextOccurrenceAt,
    targets: row.targets.map((target: any) => ({
      memberId: target.member.id,
      userId: target.member.userId,
      displayName: memberDisplayName(target.member),
      avatarUrl: target.member.profile.avatarUrl,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapReminderLog(row: {
  id: string;
  reminderId: string;
  memberId: string;
  scheduledAt: Date;
  status: string;
  processedAt: Date | null;
  completedAt: Date | null;
  member: MemberRow;
}) {
  return {
    id: row.id,
    reminderId: row.reminderId,
    memberId: row.memberId,
    recipient: {
      userId: row.member.userId,
      displayName: memberDisplayName(row.member),
    },
    scheduledAt: row.scheduledAt,
    status: row.status,
    processedAt: row.processedAt,
    completedAt: row.completedAt,
  };
}
