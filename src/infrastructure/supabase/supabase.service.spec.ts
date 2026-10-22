import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({})),
}));

describe('Supabase Auth request deadlines', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  function setup() {
    const service = new SupabaseService(
      new ConfigService({
        supabase: {
          url: 'https://supabase.example',
          anonKey: 'test-anon-key',
          serviceRoleKey: 'test-server-key',
          authTimeoutMs: 20,
        },
      }),
    );
    service.onModuleInit();
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('Request aborted')),
            { once: true },
          );
        }),
    );
    return jest.mocked(createClient).mock.calls[0][2]!.global!.fetch!;
  }

  it('aborts a stalled Auth request at the configured deadline', async () => {
    const authFetch = setup();
    await expect(
      authFetch('https://supabase.example/auth/v1/admin/users'),
    ).rejects.toThrow('Request aborted');
  });

  it('also honors cancellation requested by the original caller', async () => {
    const authFetch = setup();
    const controller = new AbortController();
    const response = authFetch('https://supabase.example/auth/v1/resend', {
      signal: controller.signal,
    });
    controller.abort();
    await expect(response).rejects.toThrow('Request aborted');
  });
});
