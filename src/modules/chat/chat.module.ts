import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';
import {
  ConversationsController,
  FamilyConversationsController,
} from './chat.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [FamilyConversationsController, ConversationsController],
  providers: [ChatRepository, ChatService],
})
export class ChatModule {}
