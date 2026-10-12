# Mission Control: The Sabotage

A cooperative space mystery for 8–10 investigators. This first increment builds the browser entry flow and authoritative multiplayer room lobby.

## What works in this increment

- Create a six-character room code or join an existing room.
- Join with a callsign, without an account or installation.
- See the room roster and connection status update live for everyone in that room.
- Reconnect with a private browser token after a temporary disconnection.
- Rooms expire after 24 hours.

The clue, discussion, voting, and reveal phases are the next game increment.

## Run locally

```sh
npm install
npm run dev:worker
```

The Cloudflare Worker serves the built frontend and `/api` routes. For local development, run `npm run build` first; Wrangler serves assets from `dist`.

## Deploy through GitHub

The repository includes a GitHub Actions deployment workflow. To turn it on:

1. Create or log in to a Cloudflare account with Workers enabled.
2. Add repository Actions secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Push to `main` or run the **Deploy game** workflow from the Actions tab.
4. Share the resulting `workers.dev` URL with players.

The Worker serves both the game files and multiplayer room service. Cloudflare's Workers Free plan includes Durable Objects with usage limits; requests that exceed free limits may be rejected. Check the account's current limits before inviting a large audience. GitHub hosts the source and runs deployment; Cloudflare serves the live game.