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
import { WriteMetricsService } from './write-metrics.service';

export interface ClientInfo {
  /** Socket ID */
  id: string;
  /** Keys the client subscribed to. null = connected but not yet subscribed. */
  subscribedKeys: string[] | 'all' | null;
  /** Unix timestamp (ms) when the client connected */
  connectedAt: number;
  /** How long the client has been connected, in milliseconds */
  connectedForMs: number;
  /** Remote IP address of the client */
  remoteAddress: string | null;
  /** Remote port of the client */
  remotePort: number | null;
}

export interface ConnectedClientsReport {
  /** Total number of connected WebSocket clients */
  total: number;
  clients: ClientInfo[];
}

@WebSocketGateway({ namespace: '/store', cors: { origin: '*' } })
export class StoreGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  /** socketId → unsub function */
  private readonly subscriptions = new Map<string, () => void>();

  /** socketId → subscribed keys (null = connected, not subscribed yet) */
  private readonly clientKeys = new Map<string, string[] | 'all' | null>();

  /** socketId → connection timestamp (ms) */
  private readonly clientConnectedAt = new Map<string, number>();

  /** socketId → remote address info */
  private readonly clientAddresses = new Map<string, { ip: string | null; port: number | null }>();

  private readonly apiKey: string | undefined;

  constructor(
    private readonly storeService: StoreService,
    private readonly configService: ConfigService,
    private readonly writeMetricsService: WriteMetricsService,
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
    if (this.apiKey) {
      const provided: string =
        (client.handshake?.auth?.['apiKey'] as string) ??
        (client.handshake?.query?.['api_key'] as string) ??
        '';

      if (provided !== this.apiKey) {
        client.emit('error', { message: 'Invalid or missing API key' });
        client.disconnect(true);
        return;
      }
    }

    this.clientKeys.set(client.id, null);
    this.clientConnectedAt.set(client.id, Date.now());
    this.clientAddresses.set(client.id, {
      ip: client.handshake?.address ?? null,
      port: (client.request?.socket as any)?.remotePort ?? null,
    });
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
      this.clientKeys.set(client.id, 'all');
      client.emit('subscribed', { keys: 'all' });
    } else {
      // Subscribe to specific keys
      const unsub = this.storeService.onChangeMulti(keys, (key, point) => {
        client.emit('dataChange', { key, point });
      });
      this.subscriptions.set(client.id, unsub);
      this.clientKeys.set(client.id, keys);
      client.emit('subscribed', { keys });
    }
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket): void {
    this.subscriptions.get(client.id)?.();
    this.subscriptions.delete(client.id);
    this.clientKeys.set(client.id, null);
    client.emit('unsubscribed', {});
  }

  @SubscribeMessage('write')
  handleWrite(
    _client: Socket,
    payload: { key: string; value: number | string; timestamp?: number },
  ): void {
    if (typeof payload?.key !== 'string' || payload?.value === undefined) {
      this.writeMetricsService.recordMalformed('ws');
      return;
    }

    this.writeMetricsService.recordAttempt('ws', payload.key, this.storeService.write(payload.key, payload.value, payload.timestamp));
  }

  handleDisconnect(client: Socket): void {
    this.subscriptions.get(client.id)?.();
    this.subscriptions.delete(client.id);
    this.clientKeys.delete(client.id);
    this.clientConnectedAt.delete(client.id);
    this.clientAddresses.delete(client.id);
  }

  /** Returns info about all currently connected WebSocket clients. */
  getConnectedClients(): ConnectedClientsReport {
    const now = Date.now();
    const clients: ClientInfo[] = [];
    for (const [id, subscribedKeys] of this.clientKeys) {
      const connectedAt = this.clientConnectedAt.get(id) ?? now;
      const addr = this.clientAddresses.get(id);
      clients.push({
        id,
        subscribedKeys,
        connectedAt,
        connectedForMs: now - connectedAt,
        remoteAddress: addr?.ip ?? null,
        remotePort: addr?.port ?? null,
      });
    }
    return { total: clients.length, clients };
  }

  /**
   * Forcefully disconnect a client by socket ID.
   * @returns true if the client was found and disconnected, false if not found.
   */
  disconnectClient(id: string): boolean {
    if (!this.clientKeys.has(id)) return false;
    // Each socket is automatically joined to a room with its own ID.
    // server.in(id).disconnectSockets(true) closes the underlying connection.
    this.server?.in(id).disconnectSockets(true);
    return true;
  }
}
