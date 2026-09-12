import { FamiliesRepository } from './families.repository';
import { PrismaService } from '../../infrastructure/database/prisma.service';

describe('FamiliesRepository family creation transaction', () => {
  const dto = {
    familyName: 'Gia đình An',
    familyLabel: 'caregiver' as const,
  };

  it('creates the family and accepted manager in one transaction', async () => {
    const memberCreate = jest.fn().mockResolvedValue({
      id: 'member-1',
      role: 'manager',
      status: 'accepted',
    });
    const tx = {
      family: {
        create: jest.fn().mockResolvedValue({ id: 'family-1' }),
      },
      familyMember: { create: memberCreate },
    };
    const transaction = jest.fn((callback) => callback(tx));
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;

    const result = await new FamiliesRepository(prisma).createFamilyWithOwner(
      'user-1',
      dto,
    );
    expect(result.membership).toMatchObject({
      role: 'manager',
      status: 'accepted',
    });
    expect(memberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: 'family-1',
          userId: 'user-1',
          role: 'manager',
          status: 'accepted',
        }),
      }),
    );
  });

  it('rejects the transaction when manager membership creation fails', async () => {
    const tx = {
      family: { create: jest.fn().mockResolvedValue({ id: 'family-1' }) },
      familyMember: {
        create: jest.fn().mockRejectedValue(new Error('member write failed')),
      },
    };
    const transaction = jest.fn((callback) => callback(tx));
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new FamiliesRepository(prisma).createFamilyWithOwner('user-1', dto),
    ).rejects.toThrow('member write failed');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
