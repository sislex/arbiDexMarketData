import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { StoreService } from './store.service';

@WebSocketGateway({ namespace: '/store', cors: { origin: '*' } })
export class StoreGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  /** socketId → unsub function */
  private readonly subscriptions = new Map<string, () => void>();

  private readonly apiKey: string | undefined;

  constructor(
    private readonly storeService: StoreService,
    private readonly configService: ConfigService,
  ) {
    const key = configService.get<string>('API_KEY', '').trim();
    this.apiKey = key || undefined;
  }

  /**
   * Reject connection if API_KEY is configured and the client did not provide it.
   *
   * Client should pass the key via:
   *   io(url, { auth: { apiKey: '<key>' } })
   * or as a query param:
   *   io(url, { query: { api_key: '<key>' } })
   */
  handleConnection(client: Socket): void {
    if (!this.apiKey) return; // auth disabled

    const provided: string =
      (client.handshake?.auth?.['apiKey'] as string) ??
      (client.handshake?.query?.['api_key'] as string) ??
      '';

    if (provided !== this.apiKey) {
      client.emit('error', { message: 'Invalid or missing API key' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    client: Socket,
    payload: { keys?: string[] },
  ): void {
    // Unsubscribe any previous subscription
    this.subscriptions.get(client.id)?.();

    const keys = payload?.keys;

    if (!keys || keys.length === 0) {
      // Subscribe to all changes
      const unsub = this.storeService.onAnyChange((key, point) => {
        client.emit('dataChange', { key, point });
      });
      this.subscriptions.set(client.id, unsub);
      client.emit('subscribed', { keys: 'all' });
    } else {
      // Subscribe to specific keys
      const unsub = this.storeService.onChangeMulti(keys, (key, point) => {
        client.emit('dataChange', { key, point });
      });
      this.subscriptions.set(client.id, unsub);
      client.emit('subscribed', { keys });
    }
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket): void {
    this.subscriptions.get(client.id)?.();
    this.subscriptions.delete(client.id);
    client.emit('unsubscribed', {});
  }

  @SubscribeMessage('write')
  handleWrite(
    _client: Socket,
    payload: { key: string; value: number; timestamp?: number },
  ): void {
    if (payload?.key !== undefined && payload?.value !== undefined) {
      this.storeService.write(payload.key, payload.value, payload.timestamp);
    }
  }

  handleDisconnect(client: Socket): void {
    this.subscriptions.get(client.id)?.();
    this.subscriptions.delete(client.id);
  }
}

