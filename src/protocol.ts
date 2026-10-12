export interface PublicPlayer {
  id: string;
  name: string;
  host: boolean;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: "lobby";
  players: PublicPlayer[];
  capacity: number;
}

export interface JoinCredentials {
  playerId: string;
  reconnectToken: string;
}

export type ServerMessage =
  | { type: "ready" }
  | { type: "joined"; credentials: JoinCredentials; snapshot: RoomSnapshot }
  | { type: "room_update"; snapshot: RoomSnapshot }
  | { type: "error"; message: string };

export interface ClientMessage {
  type: "join";
  name: string;
  credentials?: JoinCredentials;
}
