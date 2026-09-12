import {
  chatListQuerySchema,
  createDirectSchema,
  createGroupSchema,
  markReadSchema,
  sendMessageSchema,
} from './chat.dto';

const ID = '11111111-1111-4111-8111-111111111111';

describe('Phase 12 chat DTO validation', () => {
  it('accepts strict text messages and trims content', () => {
    expect(
      sendMessageSchema.parse({ clientMessageId: ID, content: ' hi ' }),
    ).toEqual({
      clientMessageId: ID,
      content: 'hi',
    });
  });

  it.each([
    [{ clientMessageId: ID, content: '' }],
    [{ clientMessageId: ID, content: 'x'.repeat(4001) }],
    [{ clientMessageId: ID, content: 'hi', mediaUrl: 'https://private' }],
    [{ clientMessageId: ID, content: 'hi', senderId: ID }],
    [
      {
        clientMessageId: ID,
        content: 'hi',
        createdAt: new Date().toISOString(),
      },
    ],
  ])('rejects invalid or client-controlled message fields', (input) => {
    expect(sendMessageSchema.safeParse(input).success).toBe(false);
  });

  it('rejects client-selected direct conversation family/sender fields', () => {
    expect(
      createDirectSchema.safeParse({ targetMemberId: ID, userId: ID }).success,
    ).toBe(false);
  });

  it('requires unique bounded group members', () => {
    expect(
      createGroupSchema.safeParse({ title: 'Family', memberIds: [ID, ID] })
        .success,
    ).toBe(false);
  });

  it('rejects per-message read receipt fields', () => {
    expect(
      markReadSchema.safeParse({ lastReadMessageId: ID, readAt: new Date() })
        .success,
    ).toBe(false);
  });

  it('bounds list pagination and rejects filter probing', () => {
    expect(chatListQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(chatListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(chatListQuerySchema.safeParse({ senderId: ID }).success).toBe(false);
  });
});
