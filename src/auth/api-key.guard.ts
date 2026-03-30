import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guards REST endpoints with an API key.
 *
 * If the env variable API_KEY is not set the guard is transparent (dev mode).
 *
 * Accepted locations (priority order):
 *   1. Header:      x-api-key: <key>
 *   2. Query param: ?api_key=<key>
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const key = configService.get<string>('API_KEY', '').trim();
    this.apiKey = key || undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    // Auth disabled — no API_KEY configured
    if (!this.apiKey) return true;

    // Only guard HTTP context; WebSocket auth is handled per-connection in StoreGateway
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Record<string, any>>();
    const provided: string =
      (req.headers?.['x-api-key'] as string) ??
      (req.query?.['api_key'] as string) ??
      '';

    if (provided !== this.apiKey) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}

