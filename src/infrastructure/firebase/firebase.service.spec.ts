import { ConfigService } from '@nestjs/config';
import { classifyFcmError, FirebaseService } from './firebase.service';

describe('FirebaseService disabled behavior', () => {
  it('never reports a fake successful delivery when FCM is disabled', async () => {
    const service = new FirebaseService({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);
    service.onModuleInit();

    await expect(
      service.sendPushNotification({
        token: 'sensitive-token',
        title: 'Private title',
        body: 'Private body',
      }),
    ).resolves.toEqual({ status: 'disabled' });

    await expect(
      service.sendDataMessage({
        token: 'sensitive-token',
        data: { type: 'phone_command' },
      }),
    ).resolves.toEqual({ status: 'disabled' });

    await expect(
      service.sendMulticastPushNotification({
        tokens: ['sensitive-token'],
        title: 'Private title',
        body: 'Private body',
      }),
    ).resolves.toEqual({
      status: 'disabled',
      successCount: 0,
      failureCount: 0,
    });
  });
});

describe('FCM error classification', () => {
  it('clears only permanent invalid registration tokens', () => {
    expect(
      classifyFcmError({ code: 'messaging/registration-token-not-registered' }),
    ).toEqual({
      errorCategory: 'invalid_token',
      retryable: false,
      invalidToken: true,
    });
    expect(classifyFcmError({ code: 'messaging/internal-error' })).toEqual({
      errorCategory: 'transient',
      retryable: true,
      invalidToken: false,
    });
  });

  it('does not retry configuration or unknown permanent failures', () => {
    expect(
      classifyFcmError({ code: 'messaging/mismatched-credential' }),
    ).toMatchObject({
      errorCategory: 'configuration',
      retryable: false,
      invalidToken: false,
    });
    expect(classifyFcmError(new Error('opaque'))).toMatchObject({
      errorCategory: 'permanent',
      retryable: false,
      invalidToken: false,
    });
  });
});
