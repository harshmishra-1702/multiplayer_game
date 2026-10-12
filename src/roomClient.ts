import type { JoinCredentials, RoomSnapshot, ServerMessage } from "./protocol";

const credentialsKey = (code: string) => `mission-control:${code}:credentials`;

export function getSavedCredentials(code: string): JoinCredentials | undefined {
  try {
    const raw = localStorage.getItem(credentialsKey(code));
    return raw ? (JSON.parse(raw) as JoinCredentials) : undefined;
  } catch {
    return undefined;
  }
}

export function saveCredentials(code: string, credentials: JoinCredentials) {
  localStorage.setItem(credentialsKey(code), JSON.stringify(credentials));
}

export function connectToRoom(
  code: string,
  name: string,
  callbacks: {
    onJoined: (snapshot: RoomSnapshot) => void;
    onUpdate: (snapshot: RoomSnapshot) => void;
    onError: (message: string) => void;
    onStatus: (status: "connecting" | "connected" | "disconnected") => void;
  },
) {
  const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(
    `${socketProtocol}//${window.location.host}/api/rooms/${encodeURIComponent(code)}/ws`,
  );
  let joined = false;

  callbacks.onStatus("connecting");

  socket.addEventListener("open", () => {
    callbacks.onStatus("connected");
    socket.send(
      JSON.stringify({
        type: "join",
        name,
        credentials: getSavedCredentials(code),
      }),
    );
  });

  socket.addEventListener("message", (event) => {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(event.data)) as ServerMessage;
    } catch {
      callbacks.onError("Mission Control sent an unreadable update. Reconnect and try again.");
      return;
    }

    if (message.type === "joined") {
      joined = true;
      saveCredentials(code, message.credentials);
      callbacks.onJoined(message.snapshot);
    } else if (message.type === "room_update") {
      callbacks.onUpdate(message.snapshot);
    } else if (message.type === "error") {
      callbacks.onError(message.message);
      socket.close(1008, "Join rejected");
    }
  });

  socket.addEventListener("close", () => {
    callbacks.onStatus("disconnected");
    if (!joined) callbacks.onError("Connection closed before joining. Check the room code and try again.");
  });

  socket.addEventListener("error", () => {
    callbacks.onStatus("disconnected");
    callbacks.onError("Could not reach Mission Control. Check your connection and try again.");
  });

  return () => socket.close(1000, "Player left room");
}

export async function createRoom() {
  const response = await fetch("/api/rooms", { method: "POST" });
  const result = (await response.json()) as { code?: string; error?: string };
  if (!response.ok || !result.code) {
    throw new Error(result.error ?? "Could not create a room right now.");
  }
  return result.code;
}
