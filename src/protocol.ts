export interface PublicPlayer {
  id: string;
  name: string;
  host: boolean;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: "lobby" | "investigation" | "voting" | "reveal";
  players: PublicPlayer[];
  capacity: number;
  serverNow: number;
  deadlineAt?: number | null;
  suspects?: CrewMember[];
  clue?: ClueCard;
  sharedClues?: SharedClue[];
  votesCast?: number;
  voteSubmitted?: boolean;
  culpritId?: string;
  voteTally?: Record<string, number>;
  outcome?: "success" | "miss";
}

export interface CrewMember {
  id: string;
  name: string;
  role: string;
}

export interface ClueCard {
  id: string;
  title: string;
  text: string;
  evidence?: boolean;
}

export interface SharedClue {
  playerId: string;
  playerName: string;
  clue: ClueCard;
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

export type ClientMessage =
  | { type: "join"; name: string; credentials?: JoinCredentials }
  | { type: "start" }
  | { type: "share_clue" }
  | { type: "vote"; suspectId: string }
  | { type: "new_round" };
