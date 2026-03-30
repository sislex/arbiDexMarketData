import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from '../api-key.guard';

const makeGuard = (apiKey: string) =>
  new ApiKeyGuard({ get: (_key: string, def = '') => apiKey || def } as unknown as ConfigService);

const makeHttpContext = (headers: Record<string, string> = {}, query: Record<string, string> = {}): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ headers, query }),
    }),
  }) as unknown as ExecutionContext;

const makeWsContext = (): ExecutionContext =>
  ({
    getType: () => 'ws',
  }) as unknown as ExecutionContext;

describe('ApiKeyGuard', () => {
  // ── Auth disabled ────────────────────────────────────────────
  describe('when API_KEY is not configured', () => {
    let guard: ApiKeyGuard;

    beforeEach(() => {
      guard = makeGuard('');
    });

    it('should allow any HTTP request', () => {
      expect(guard.canActivate(makeHttpContext())).toBe(true);
    });

    it('should allow WebSocket context', () => {
      expect(guard.canActivate(makeWsContext())).toBe(true);
    });
  });

  // ── Auth enabled ─────────────────────────────────────────────
  describe('when API_KEY is configured', () => {
    const SECRET = 'super-secret-key';
    let guard: ApiKeyGuard;

    beforeEach(() => {
      guard = makeGuard(SECRET);
    });

    it('should allow request with correct x-api-key header', () => {
      const ctx = makeHttpContext({ 'x-api-key': SECRET });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should allow request with correct api_key query param', () => {
      const ctx = makeHttpContext({}, { api_key: SECRET });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should prefer header over query param', () => {
      const ctx = makeHttpContext({ 'x-api-key': SECRET }, { api_key: 'wrong' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should throw UnauthorizedException when no key provided', () => {
      const ctx = makeHttpContext();
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when wrong key in header', () => {
      const ctx = makeHttpContext({ 'x-api-key': 'wrong-key' });
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when wrong key in query', () => {
      const ctx = makeHttpContext({}, { api_key: 'wrong-key' });
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('should pass WebSocket context (WS auth is handled in handleConnection)', () => {
      expect(guard.canActivate(makeWsContext())).toBe(true);
    });
  });
});

