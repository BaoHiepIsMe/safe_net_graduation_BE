import {
  emptyNotificationMutationSchema,
  notificationListQuerySchema,
  notificationParamSchema,
} from './notification.dto';

describe('Phase 6 notification DTO validation', () => {
  it('applies bounded cursor pagination defaults and filters', () => {
    expect(notificationListQuerySchema.parse({})).toEqual({
      limit: 20,
      read: 'all',
    });
    expect(
      notificationListQuerySchema.parse({
        limit: '100',
        read: 'unread',
        type: 'geofence_enter',
      }),
    ).toMatchObject({ limit: 100, read: 'unread' });
    expect(
      notificationListQuerySchema.parse({ type: 'sos_alert' }),
    ).toMatchObject({ type: 'sos_alert' });
    expect(
      notificationListQuerySchema.parse({ type: 'reminder' }),
    ).toMatchObject({ type: 'reminder' });
  });

  it('rejects unknown filters, invalid cursors, limits and ids', () => {
    expect(() => notificationListQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() =>
      notificationListQuerySchema.parse({ cursor: 'not cursor' }),
    ).toThrow();
    expect(() =>
      notificationListQuerySchema.parse({ userId: crypto.randomUUID() }),
    ).toThrow();
    expect(() =>
      notificationParamSchema.parse({ notificationId: 'bad' }),
    ).toThrow();
  });

  it('rejects mass assignment in read mutations', () => {
    expect(emptyNotificationMutationSchema.parse({})).toEqual({});
    expect(() =>
      emptyNotificationMutationSchema.parse({ isRead: true }),
    ).toThrow();
    expect(() =>
      emptyNotificationMutationSchema.parse({ readAt: new Date() }),
    ).toThrow();
  });
});
