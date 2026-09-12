import {
  createCorsOptions,
  LOCAL_DEVELOPMENT_ORIGINS,
  resolveCorsOrigins,
} from './cors.config';
import { withValidatedSocketCors } from '../infrastructure/realtime/configured-socket-io.adapter';

describe('shared REST and Socket.IO CORS configuration', () => {
  it('uses safe localhost origins for development by default', () => {
    expect(resolveCorsOrigins()).toEqual(LOCAL_DEVELOPMENT_ORIGINS);
  });

  it('keeps configured development origins and rejects foreign origins', () => {
    const cors = createCorsOptions(
      'http://localhost:5173,http://localhost:8080',
    );
    expect(cors.origin).toContain('http://localhost:5173');
    expect(cors.origin).not.toContain('https://foreign.example');
  });

  it('uses the same validated CORS options for Socket.IO', () => {
    const shared = createCorsOptions(['https://app.safenet.example']);
    const socketOptions = withValidatedSocketCors(undefined, shared);
    expect(socketOptions.cors).toEqual(shared);
  });
});
