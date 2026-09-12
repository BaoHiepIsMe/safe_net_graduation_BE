import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private adminClient: SupabaseClient | null = null;
  private authClient: SupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const supabaseUrl = this.configService.get<string>('supabase.url') || '';
    const anonKey = this.configService.get<string>('supabase.anonKey') || '';
    const serviceRoleKey =
      this.configService.get<string>('supabase.serviceRoleKey') || '';

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      this.logger.warn(
        'Supabase is disabled because required development configuration is incomplete.',
      );
      return;
    }

    const clientOptions = {
      auth: { autoRefreshToken: false, persistSession: false },
    };
    this.authClient = createClient(supabaseUrl, anonKey, clientOptions);
    this.adminClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
  }

  getAdminAuthClient(): SupabaseClient {
    if (!this.adminClient) {
      throw new Error('Supabase admin client is not configured');
    }
    return this.adminClient;
  }

  getAuthClient(): SupabaseClient {
    if (!this.authClient) {
      throw new Error('Supabase auth client is not configured');
    }
    return this.authClient;
  }

  async verifyToken(token: string): Promise<AuthUser | null> {
    try {
      const { data, error } = await this.getAuthClient().auth.getUser(token);
      if (error || !data?.user) return null;

      const user = data.user;
      return {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        app_metadata: user.app_metadata,
        user_metadata: user.user_metadata,
      };
    } catch {
      this.logger.warn('Supabase access-token verification failed');
      return null;
    }
  }
}
