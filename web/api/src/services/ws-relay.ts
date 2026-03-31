import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { prisma, redis } from '../index.js';

const JWT_SECRET = process.env['JWT_SECRET'] || 'hanseol-web-secret';
const EVENT_TTL = 3600; // 1 hour in Redis

const wss = new WebSocketServer({ noServer: true });

// Active relay connections: sessionId -> { browser, container }
const activeRelays = new Map<
  string,
  { browser: WebSocket; container: WebSocket | null; sessionId: string; userId: string }
>();

/**
 * Handle WebSocket upgrade from HTTP server
 */
export function handleWebSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
}

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');
  const token = url.searchParams.get('token');

  if (!sessionId || !token) {
    ws.close(4001, 'Missing sessionId or token');
    return;
  }

  // Authenticate
  let userId: string;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = payload.userId;
  } catch {
    ws.close(4003, 'Invalid token');
    return;
  }

  // Verify session ownership
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId, status: 'RUNNING' },
  });

  if (!session || !session.containerPort) {
    ws.close(4004, 'Session not found or not running');
    return;
  }

  // Close any existing relay for this session
  const existing = activeRelays.get(sessionId);
  if (existing) {
    existing.browser.close(4005, 'Replaced by new connection');
    if (existing.container) existing.container.close();
    activeRelays.delete(sessionId);
  }

  // Connect to session container WebSocket
  const containerWsUrl = `ws://localhost:${session.containerPort}`;
  let containerWs: WebSocket | null = null;

  try {
    containerWs = new WebSocket(containerWsUrl);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        containerWs!.close();
        reject(new Error('Container WS connection timeout'));
      }, 10000);
      containerWs!.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      containerWs!.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  } catch (err) {
    console.error(`[WS Relay] Failed to connect to container WS:`, err);
    ws.close(4005, 'Failed to connect to session container');
    return;
  }

  const relay = { browser: ws, container: containerWs, sessionId, userId };
  activeRelays.set(sessionId, relay);

  // Replay missed events on reconnection
  const lastSeq = url.searchParams.get('lastSeq');
  if (lastSeq) {
    const missedEvents = await getMissedEvents(sessionId, parseInt(lastSeq, 10));
    for (const event of missedEvents) {
      ws.send(event);
    }
  }

  // Container -> Browser relay
  containerWs.on('open', () => {
    console.log(`[WS Relay] Container connected for session ${sessionId}`);
  });

  containerWs.on('message', async (data: Buffer | string) => {
    const message = data.toString();

    // Skip heartbeat events — don't store or relay pong
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'pong') return;
    } catch {
      // Not valid JSON — still forward to browser (don't drop messages)
    }

    // Forward to browser immediately (don't wait for storage)
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }

    // Store event in Redis/DB for reconnection support
    storeEvent(sessionId, message).catch(() => {});
  });

  containerWs.on('close', () => {
    console.log(`[WS Relay] Container disconnected for session ${sessionId}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'system', data: { message: 'Container disconnected' } }));
    }
  });

  containerWs.on('error', (err) => {
    console.error(`[WS Relay] Container WS error for session ${sessionId}:`, err.message);
  });

  // Browser -> Container relay
  ws.on('message', (data: Buffer | string) => {
    const message = data.toString();

    // Forward to container
    if (containerWs && containerWs.readyState === WebSocket.OPEN) {
      containerWs.send(message);
    }

    // Update session activity
    prisma.session
      .update({
        where: { id: sessionId },
        data: { lastActiveAt: new Date() },
      })
      .catch((err) => console.error('[WS] Session update failed:', err.message));
  });

  ws.on('close', () => {
    console.log(`[WS Relay] Browser disconnected for session ${sessionId}`);
    activeRelays.delete(sessionId);
    // Don't close container — it keeps running for reconnection
  });

  ws.on('error', (err) => {
    console.error(`[WS Relay] Browser WS error for session ${sessionId}:`, err.message);
  });

  // Heartbeat: ping every 30 seconds
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  ws.on('close', () => clearInterval(pingInterval));
});

/**
 * Store an event in Redis for reconnection replay
 */
async function storeEvent(sessionId: string, message: string): Promise<void> {
  const key = `ws:events:${sessionId}`;
  try {
    // Redis (real-time replay)
    const len = await redis.rpush(key, message);
    await redis.ltrim(key, -500, -1);
    await redis.expire(key, EVENT_TTL);

    // DB (persistent — used as fallback when Redis expires)
    try {
      const parsed = JSON.parse(message);
      prisma.sessionEvent.create({
        data: {
          sessionId,
          sequence: len,
          type: parsed.type || 'unknown',
          data: parsed.payload || parsed,
        },
      }).catch(() => {}); // Fire-and-forget (DB write rarely fails on local PG)
    } catch {
      // Non-critical
    }
  } catch {
    // Non-critical: event replay is best-effort
  }
}

/**
 * Get missed events for session restore or reconnection.
 *
 * lastSeq=0 (initial connection / page load):
 *   Always use DB as authoritative source. Redis may only have partial data
 *   if TTL expired and the container kept sending new events afterwards.
 *
 * lastSeq>0 (auto-reconnection after brief disconnect):
 *   Use Redis for gap fill. The browser already has events 0..lastSeq.
 */
async function getMissedEvents(sessionId: string, lastSeq: number): Promise<string[]> {
  const key = `ws:events:${sessionId}`;
  try {
    // Initial connection: DB is authoritative (Redis may have partial data)
    if (lastSeq <= 0) {
      try {
        const dbEvents = await prisma.sessionEvent.findMany({
          where: { sessionId, type: { notIn: ['pong', 'ping'] } },
          orderBy: { createdAt: 'asc' },
          take: 2000,
        });
        if (dbEvents.length > 0) {
          console.log(`[WS Relay] Restored ${dbEvents.length} events from DB for session ${sessionId}`);
          const restored = dbEvents.map((e) =>
            JSON.stringify({ type: e.type, payload: e.data }),
          );
          // Sync Redis with complete history for subsequent reconnections
          await redis.del(key);
          await redis.rpush(key, ...restored);
          await redis.expire(key, EVENT_TTL);
          return restored;
        }
      } catch (dbErr) {
        console.error('[WS Relay] DB load failed, falling back to Redis:', dbErr);
      }

      // DB empty or failed — fall back to whatever Redis has
      const events = await redis.lrange(key, 0, -1);
      return events;
    }

    // Auto-reconnection: use Redis for gap fill
    const events = await redis.lrange(key, 0, -1);
    return events.slice(lastSeq);
  } catch {
    return [];
  }
}

/**
 * Clean up Redis events for a session (called on session deletion)
 */
export async function cleanupSessionEvents(sessionId: string): Promise<void> {
  try {
    await redis.del(`ws:events:${sessionId}`);
  } catch {
    // Non-critical
  }
}
