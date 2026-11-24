import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import {
  getMessaging,
  type Message,
  type MulticastMessage,
} from 'firebase-admin/messaging';

export interface PushNotificationPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** A silent message the app handles itself, even in the background. */
export interface DataMessagePayload {
  token: string;
  data: Record<string, string>;
}

export interface MulticastNotificationPayload {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export type FcmDeliveryStatus = 'disabled' | 'success' | 'failure';
export type FcmErrorCategory =
  'invalid_token' | 'transient' | 'configuration' | 'permanent';

export interface FcmDeliveryResult {
  status: FcmDeliveryStatus;
  errorCategory?: FcmErrorCategory;
  retryable?: boolean;
  invalidToken?: boolean;
}

export interface FcmMulticastDeliveryResult extends FcmDeliveryResult {
  successCount: number;
  failureCount: number;
}

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private firebaseApp: App | null = null;
  private isInitialized = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const projectId = this.configService.get<string>('firebase.projectId');
    const clientEmail = this.configService.get<string>('firebase.clientEmail');
    const privateKey = this.configService.get<string>('firebase.privateKey');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase configuration is incomplete; FCM is disabled.',
      );
      return;
    }

    try {
      const apps = getApps();
      if (apps.length === 0) {
        this.firebaseApp = initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
      } else {
        this.firebaseApp = apps[0];
      }
      this.isInitialized = true;
      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch {
      this.logger.warn(
        'Firebase Admin SDK initialization failed; FCM is disabled.',
      );
    }
  }

  async sendPushNotification(
    payload: PushNotificationPayload,
  ): Promise<FcmDeliveryResult> {
    if (!this.isInitialized || !this.firebaseApp) {
      return { status: 'disabled' };
    }

    try {
      const message: Message = {
        token: payload.token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
      };

      await getMessaging(this.firebaseApp).send(message);
      return { status: 'success' };
    } catch (error) {
      this.logger.error('FCM single-message delivery failed');
      return { status: 'failure', ...classifyFcmError(error) };
    }
  }

  /**
   * Data-only and high priority: Android wakes the app to run its
   * background handler instead of showing a notification.
   */
  async sendDataMessage(
    payload: DataMessagePayload,
  ): Promise<FcmDeliveryResult> {
    if (!this.isInitialized || !this.firebaseApp) {
      return { status: 'disabled' };
    }

    try {
      const message: Message = {
        token: payload.token,
        data: payload.data,
        android: { priority: 'high' },
        apns: {
          headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
          payload: { aps: { contentAvailable: true } },
        },
      };

      await getMessaging(this.firebaseApp).send(message);
      return { status: 'success' };
    } catch (error) {
      this.logger.error('FCM data-message delivery failed');
      return { status: 'failure', ...classifyFcmError(error) };
    }
  }

  async sendMulticastPushNotification(
    payload: MulticastNotificationPayload,
  ): Promise<FcmMulticastDeliveryResult> {
    if (!payload.tokens || payload.tokens.length === 0) {
      return { status: 'success', successCount: 0, failureCount: 0 };
    }

    if (!this.isInitialized || !this.firebaseApp) {
      return { status: 'disabled', successCount: 0, failureCount: 0 };
    }

    try {
      const message: MulticastMessage = {
        tokens: payload.tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
      };

      const response = await getMessaging(
        this.firebaseApp,
      ).sendEachForMulticast(message);
      return {
        status: response.failureCount === 0 ? 'success' : 'failure',
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch {
      this.logger.error('FCM multicast delivery failed');
      return {
        status: 'failure',
        successCount: 0,
        failureCount: payload.tokens.length,
      };
    }
  }
}

export function classifyFcmError(error: unknown): {
  errorCategory: FcmErrorCategory;
  retryable: boolean;
  invalidToken: boolean;
} {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
  if (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token'
  ) {
    return {
      errorCategory: 'invalid_token',
      retryable: false,
      invalidToken: true,
    };
  }
  if (
    [
      'messaging/internal-error',
      'messaging/server-unavailable',
      'messaging/unknown-error',
      'app/network-error',
      'app/network-timeout',
    ].includes(code)
  ) {
    return { errorCategory: 'transient', retryable: true, invalidToken: false };
  }
  if (
    [
      'messaging/authentication-error',
      'messaging/mismatched-credential',
      'app/invalid-credential',
    ].includes(code)
  ) {
    return {
      errorCategory: 'configuration',
      retryable: false,
      invalidToken: false,
    };
  }
  return { errorCategory: 'permanent', retryable: false, invalidToken: false };
}
