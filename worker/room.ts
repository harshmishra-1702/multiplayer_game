import { DurableObject } from "cloudflare:workers";

interface Env {}

interface Player {
  id: string;
  name: string;
  token: string;
  host: boolean;
  connected: boolean;
  joinedAt: number;
}

interface RoomState {
  code: string;
  createdAt: number;
  phase: "lobby";
  players: Player[];
}

interface JoinMessage {
  type: "join";
  name?: unknown;
  credentials?: { playerId?: unknown; reconnectToken?: unknown };
}

const ROOM_CAPACITY = 10;
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function makeId() {
  return crypto.randomUUID();
}

function makeReconnectToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validCode(code: string | undefined): code is string {
  return Boolean(code && code.length === 6 && [...code].every((letter) => CODE_ALPHABET.includes(letter)));
}

export class GameRoom extends DurableObject<Env> {
  private state: RoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/initialize" && request.method === "POST") {
      const code = url.searchParams.get("code") ?? "";
      if (!validCode(code)) return new Response("Invalid room code", { status: 400 });
      const current = await this.loadState();
      if (current && Date.now() - current.createdAt < ROOM_LIFETIME_MS) return new Response("Room code already in use", { status: 409 });

      this.state = { code, createdAt: Date.now(), phase: "lobby", players: [] };
      await this.ctx.storage.put("room", this.state);
      await this.ctx.storage.setAlarm(this.state.createdAt + ROOM_LIFETIME_MS);
      return new Response("Created", { status: 201 });
    }

    if (url.pathname === "/ws") {
      const current = await this.loadState();
      if (!current || Date.now() - current.createdAt >= ROOM_LIFETIME_MS) {
        return new Response("This room has expired. Create a new room to continue.", { status: 404 });
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "ready" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer) {
    let message: JoinMessage;
    try {
      message = JSON.parse(typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage)) as JoinMessage;
    } catch {
      this.send(socket, { type: "error", message: "That message could not be read. Please reconnect." });
      return;
    }

    if (message.type !== "join") {
      this.send(socket, { type: "error", message: "That action isn’t available yet." });
      return;
    }

    const state = await this.loadState();
    if (!state || Date.now() - state.createdAt >= ROOM_LIFETIME_MS) {
      this.send(socket, { type: "error", message: "This room has expired. Create a new room to continue." });
      return;
    }

    const name = typeof message.name === "string" ? message.name.trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 20) : "";
    if (!name) {
      this.send(socket, { type: "error", message: "Choose a callsign before boarding." });
      return;
    }

    const suppliedId = typeof message.credentials?.playerId === "string" ? message.credentials.playerId : "";
    const suppliedToken = typeof message.credentials?.reconnectToken === "string" ? message.credentials.reconnectToken : "";
    const player = state.players.find((candidate) => candidate.id === suppliedId && candidate.token === suppliedToken);

    if (player) {
      player.name = name;
      player.connected = true;
    } else {
      if (state.players.length >= ROOM_CAPACITY) {
        this.send(socket, { type: "error", message: "This crew is full. Ask for another room code." });
        return;
      }
      state.players.push({
        id: makeId(),
        name,
        token: makeReconnectToken(),
        host: state.players.length === 0,
        connected: true,
        joinedAt: Date.now(),
      });
    }

    const activePlayer = player ?? state.players[state.players.length - 1];
    socket.serializeAttachment({ playerId: activePlayer.id });
    await this.ctx.storage.put("room", state);
    this.state = state;
    this.send(socket, {
      type: "joined",
      credentials: { playerId: activePlayer.id, reconnectToken: activePlayer.token },
      snapshot: this.publicSnapshot(state),
    });
    this.broadcast(state);
  }

  async webSocketClose(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
    if (!attachment?.playerId) return;
    const state = await this.loadState();
    if (!state) return;
    const player = state.players.find((candidate) => candidate.id === attachment.playerId);
    if (!player) return;
    const anotherSocket = this.ctx.getWebSockets().some((candidate) => {
      if (candidate === socket) return false;
      const info = candidate.deserializeAttachment() as { playerId?: string } | null;
      return info?.playerId === player.id;
    });
    if (anotherSocket) return;
    player.connected = false;
    await this.ctx.storage.put("room", state);
    this.state = state;
    this.broadcast(state);
  }

  async alarm() {
    const state = await this.loadState();
    if (!state) return;
    if (Date.now() < state.createdAt + ROOM_LIFETIME_MS) {
      await this.ctx.storage.setAlarm(state.createdAt + ROOM_LIFETIME_MS);
      return;
    }
    for (const socket of this.ctx.getWebSockets()) socket.close(1000, "Room expired");
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  private async loadState() {
    if (!this.state) this.state = await this.ctx.storage.get<RoomState>("room") ?? null;
    return this.state;
  }

  private publicSnapshot(state: RoomState) {
    return {
      code: state.code,
      phase: state.phase,
      capacity: ROOM_CAPACITY,
      players: state.players.map(({ id, name, host, connected }) => ({ id, name, host, connected })),
    };
  }

  private broadcast(state: RoomState) {
    const payload = JSON.stringify({ type: "room_update", snapshot: this.publicSnapshot(state) });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "Connection interrupted");
      }
    }
  }

  private send(socket: WebSocket, payload: unknown) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      socket.close(1011, "Connection interrupted");
    }
  }
}
