import {
  createReminderBodySchema,
  reminderDataSchema,
  updateReminderBodySchema,
} from './reminders.swagger';

describe('Reminder Swagger contracts', () => {
  it('documents strict structured schedules and server-derived ownership', () => {
    expect(createReminderBodySchema.additionalProperties).toBe(false);
    expect(createReminderBodySchema.properties).not.toHaveProperty('createdBy');
    expect(createReminderBodySchema.properties.schedule.oneOf).toHaveLength(3);
    expect(updateReminderBodySchema.additionalProperties).toBe(false);
  });

  it('exposes safe reminder data without delivery or auth secrets', () => {
    expect(reminderDataSchema.properties).not.toHaveProperty('fcmToken');
    expect(reminderDataSchema.properties).not.toHaveProperty('installationId');
    expect(reminderDataSchema.properties).not.toHaveProperty('notificationId');
    expect(reminderDataSchema.properties).not.toHaveProperty('nextRunInternal');
  });
});
