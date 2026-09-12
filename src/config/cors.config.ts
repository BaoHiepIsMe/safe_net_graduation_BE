export const LOCAL_DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
];

export function resolveCorsOrigins(value?: string | string[]): string[] {
  const configured = (Array.isArray(value) ? value : (value || '').split(','))
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*');

  return configured.length > 0 ? configured : [...LOCAL_DEVELOPMENT_ORIGINS];
}

export interface SafeNetCorsOptions {
  origin: string[];
  credentials: true;
}

export function createCorsOptions(
  value?: string | string[],
): SafeNetCorsOptions {
  return {
    origin: resolveCorsOrigins(value),
    credentials: true,
  };
}
