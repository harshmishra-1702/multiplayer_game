import { DurableObject } from "cloudflare:workers";
import type { ChatMessage, ClueCard, CrewMember, RoomSnapshot, SharedClue } from "../src/protocol";
import { createCase } from "./case";

interface Env {}

interface Player {
  id: string;
  name: string;
  token: string;
  host: boolean;
  connected: boolean;
  joinedAt: number;
  lastChatAt?: number;
}

type GamePhase = RoomSnapshot["phase"];

interface RoundState {
  culpritId: string;
  cluesByPlayerId: Record<string, ClueCard>;
  suspects: CrewMember[];
  votes: Record<string, string>;
  sharedCluePlayers: string[];
  deadlineAt: number;
  outcome?: "success" | "miss";
  voteTally?: Record<string, number>;
}

interface RoomState {
  code: string;
  createdAt: number;
  phase: GamePhase;
  players: Player[];
  chatMessages?: ChatMessage[];
  round?: RoundState;
}

interface IncomingMessage {
  type?: unknown;
  name?: unknown;
  suspectId?: unknown;
  text?: unknown;
  credentials?: { playerId?: unknown; reconnectToken?: unknown };
}

const ROOM_CAPACITY = 10;
const MINIMUM_CREW = 3;
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const INVESTIGATION_MS = 4 * 60 * 1000;
const VOTING_MS = 60 * 1000;
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

    if (url.pathname.endsWith("/ws")) {
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
    let message: IncomingMessage;
    try {
      const content = typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);
      if (content.length > 4096) throw new Error("Message too large");
      message = JSON.parse(content) as IncomingMessage;
      if (!message || typeof message !== "object") throw new Error("Invalid message");
    } catch {
      this.send(socket, { type: "error", message: "That message could not be read. Please reconnect." });
      return;
    }

    if (message.type === "join") {
      await this.joinRoom(socket, message);
      return;
    }

    const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
    const state = await this.loadState();
    if (!state || !attachment?.playerId) {
      this.send(socket, { type: "error", message: "Join the room before taking that action." });
      return;
    }
    const player = state.players.find((candidate) => candidate.id === attachment.playerId);
    if (!player) {
      this.send(socket, { type: "error", message: "Your crew session expired. Rejoin the room." });
      return;
    }

    if (message.type === "start") {
      await this.startRound(socket, state, player);
    } else if (message.type === "share_clue") {
      await this.shareClue(socket, state, player);
    } else if (message.type === "vote") {
      await this.submitVote(socket, state, player, message.suspectId);
    } else if (message.type === "new_round") {
      await this.resetRound(socket, state, player);
    } else if (message.type === "chat") {
      await this.postChat(state, player, message.text);
    } else {
      this.send(socket, { type: "error", message: "That action isn’t available." });
    }
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
    if (player.host) {
      const nextHost = state.players.find((candidate) => candidate.connected && candidate.id !== player.id);
      if (nextHost) {
        player.host = false;
        nextHost.host = true;
      }
    }
    let revealNow = false;
    if (state.phase === "voting" && state.round) {
      const connectedPlayers = state.players.filter((candidate) => candidate.connected);
      revealNow = connectedPlayers.length > 0 && connectedPlayers.every((candidate) => Boolean(state.round?.votes[candidate.id]));
      if (revealNow) this.finishRound(state);
    }
    await this.ctx.storage.put("room", state);
    this.state = state;
    if (revealNow) await this.ctx.storage.setAlarm(state.createdAt + ROOM_LIFETIME_MS);
    this.broadcast(state);
  }

  async alarm() {
    const state = await this.loadState();
    if (!state) return;
    const now = Date.now();

    if (state.phase === "investigation" && state.round) {
      if (now < state.round.deadlineAt) {
        await this.ctx.storage.setAlarm(state.round.deadlineAt);
        return;
      }
      state.round.sharedCluePlayers = Object.keys(state.round.cluesByPlayerId);
      state.phase = "voting";
      state.round.deadlineAt = now + VOTING_MS;
      await this.ctx.storage.put("room", state);
      this.state = state;
      await this.ctx.storage.setAlarm(state.round.deadlineAt);
      this.broadcast(state);
      return;
    }

    if (state.phase === "voting" && state.round) {
      if (now < state.round.deadlineAt) {
        await this.ctx.storage.setAlarm(state.round.deadlineAt);
        return;
      }
      this.finishRound(state);
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.put("room", state);
      this.state = state;
      await this.ctx.storage.setAlarm(state.createdAt + ROOM_LIFETIME_MS);
      this.broadcast(state);
      return;
    }

    if (now < state.createdAt + ROOM_LIFETIME_MS) {
      await this.ctx.storage.setAlarm(state.createdAt + ROOM_LIFETIME_MS);
      return;
    }
    for (const socket of this.ctx.getWebSockets()) socket.close(1000, "Room expired");
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  private async joinRoom(socket: WebSocket, message: IncomingMessage) {
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
      if (state.phase !== "lobby") {
        this.send(socket, { type: "error", message: "This mission is already underway. Ask the host to start a new round." });
        return;
      }
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
      snapshot: this.publicSnapshot(state, activePlayer.id),
    });
    this.broadcast(state);
  }

  private async postChat(state: RoomState, player: Player, rawText: unknown) {
    if (typeof rawText !== "string") return;
    const text = rawText.replace(/[\\u0000-\\u001f\\u007f]/g, " ").trim().slice(0, 300);
    if (!text) return;

    const now = Date.now();
    if (now - (player.lastChatAt ?? 0) < 700) return;
    player.lastChatAt = now;
    state.chatMessages ??= [];
    state.chatMessages.push({ id: makeId(), playerId: player.id, playerName: player.name, text, sentAt: now });
    if (state.chatMessages.length > 100) state.chatMessages.splice(0, state.chatMessages.length - 100);
    await this.ctx.storage.put("room", state);
    this.state = state;
    this.broadcast(state);
  }

  private async startRound(socket: WebSocket, state: RoomState, player: Player) {
    if (!player.host) {
      this.send(socket, { type: "error", message: "Only the host can start the mission." });
      return;
    }
    const connectedPlayers = state.players.filter((candidate) => candidate.connected);
    if (state.phase !== "lobby") {
      this.send(socket, { type: "error", message: "This round has already started." });
      return;
    }
    if (connectedPlayers.length < MINIMUM_CREW) {
      this.send(socket, { type: "error", message: `You need ${MINIMUM_CREW} connected investigators to launch.` });
      return;
    }

    const scenario = createCase(state.players.map((candidate) => candidate.id));
    const deadlineAt = Date.now() + INVESTIGATION_MS;
    state.phase = "investigation";
    state.round = { ...scenario, votes: {}, sharedCluePlayers: [], deadlineAt };
    await this.ctx.storage.put("room", state);
    this.state = state;
    await this.ctx.storage.setAlarm(deadlineAt);
    this.broadcast(state);
  }

  private async shareClue(socket: WebSocket, state: RoomState, player: Player) {
    const round = state.round;
    if (state.phase !== "investigation" || !round) {
      this.send(socket, { type: "error", message: "You can share clues during the investigation." });
      return;
    }
    if (!round.cluesByPlayerId[player.id]) {
      this.send(socket, { type: "error", message: "Your clue isn’t available in this round." });
      return;
    }
    if (round.sharedCluePlayers.includes(player.id)) {
      this.send(socket, { type: "error", message: "Your clue is already on the evidence board." });
      return;
    }
    round.sharedCluePlayers.push(player.id);
    await this.ctx.storage.put("room", state);
    this.state = state;
    this.broadcast(state);
  }

  private async submitVote(socket: WebSocket, state: RoomState, player: Player, suspectId: unknown) {
    const round = state.round;
    if (state.phase !== "voting" || !round) {
      this.send(socket, { type: "error", message: "Voting isn’t open yet." });
      return;
    }
    if (typeof suspectId !== "string" || !round.suspects.some((suspect) => suspect.id === suspectId)) {
      this.send(socket, { type: "error", message: "Choose one crew member from the suspect list." });
      return;
    }
    if (round.votes[player.id]) {
      this.send(socket, { type: "error", message: "Your vote is already locked in." });
      return;
    }
    round.votes[player.id] = suspectId;
    const connectedPlayers = state.players.filter((candidate) => candidate.connected);
    const finished = connectedPlayers.length > 0 && connectedPlayers.every((candidate) => Boolean(round.votes[candidate.id]));
    if (finished) this.finishRound(state);
    await this.ctx.storage.put("room", state);
    this.state = state;
    if (finished) await this.ctx.storage.setAlarm(state.createdAt + ROOM_LIFETIME_MS);
    this.broadcast(state);
  }

  private async resetRound(socket: WebSocket, state: RoomState, player: Player) {
    if (!player.host) {
      this.send(socket, { type: "error", message: "Only the host can prepare the next case." });
      return;
    }
    if (state.phase !== "reveal") {
      this.send(socket, { type: "error", message: "Finish this case before preparing another." });
      return;
    }
    state.phase = "lobby";
    delete state.round;
    await this.ctx.storage.put("room", state);
    this.state = state;
    await this.ctx.storage.setAlarm(state.createdAt + ROOM_LIFETIME_MS);
    this.broadcast(state);
  }

  private finishRound(state: RoomState) {
    const round = state.round;
    if (!round) return;
    const tally: Record<string, number> = Object.fromEntries(round.suspects.map((suspect) => [suspect.id, 0]));
    Object.values(round.votes).forEach((suspectId) => { tally[suspectId] = (tally[suspectId] ?? 0) + 1; });
    const highest = Math.max(0, ...Object.values(tally));
    const leaders = Object.entries(tally).filter(([, count]) => count === highest && count > 0).map(([id]) => id);
    round.voteTally = tally;
    round.outcome = leaders.length === 1 && leaders[0] === round.culpritId ? "success" : "miss";
    round.deadlineAt = 0;
    state.phase = "reveal";
  }

  private async loadState() {
    if (!this.state) this.state = await this.ctx.storage.get<RoomState>("room") ?? null;
    return this.state;
  }

  private publicSnapshot(state: RoomState, playerId?: string): RoomSnapshot {
    const snapshot: RoomSnapshot = {
      code: state.code,
      phase: state.phase,
      capacity: ROOM_CAPACITY,
      players: state.players.map(({ id, name, host, connected }) => ({ id, name, host, connected })),
      serverNow: Date.now(),
      chatMessages: state.chatMessages ?? [],
    };
    const round = state.round;
    if (round) {
      snapshot.suspects = round.suspects;
      snapshot.deadlineAt = state.phase === "reveal" ? null : round.deadlineAt;
      snapshot.votesCast = Object.keys(round.votes).length;
      snapshot.voteSubmitted = playerId ? Boolean(round.votes[playerId]) : false;
      if (playerId && round.cluesByPlayerId[playerId]) snapshot.clue = round.cluesByPlayerId[playerId];
      snapshot.sharedClues = round.sharedCluePlayers.flatMap((sharedPlayerId): SharedClue[] => {
        const sharedPlayer = state.players.find((candidate) => candidate.id === sharedPlayerId);
        const clue = round.cluesByPlayerId[sharedPlayerId];
        return sharedPlayer && clue ? [{ playerId: sharedPlayer.id, playerName: sharedPlayer.name, clue }] : [];
      });
      if (state.phase === "reveal") {
        snapshot.culpritId = round.culpritId;
        snapshot.voteTally = round.voteTally;
        snapshot.outcome = round.outcome;
      }
    }
    return snapshot;
  }

  private broadcast(state: RoomState) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
      if (!attachment?.playerId) continue;
      try {
        socket.send(JSON.stringify({ type: "room_update", snapshot: this.publicSnapshot(state, attachment.playerId) }));
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
