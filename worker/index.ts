import { GameRoom } from "./room";

export { GameRoom };

interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
}

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = newRoomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const initialized = await stub.fetch(`https://room.internal/initialize?code=${code}`, { method: "POST" });
        if (initialized.status === 201) {
          return Response.json({ code }, { headers: { "Cache-Control": "no-store" } });
        }
      }
      return Response.json({ error: "Could not reserve a room code. Please try again." }, { status: 503 });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/ws$/i);
    if (roomMatch && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const code = roomMatch[1].toUpperCase();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
