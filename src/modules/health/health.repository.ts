import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class HealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async checkDatabaseConnection(): Promise<void> {
    await this.prisma.profile.findFirst({ select: { id: true } });
  }
}
