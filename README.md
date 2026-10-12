# Mission Control: The Sabotage

A cooperative space mystery for 8–10 investigators. Find the crew member who sabotaged the Atlas-9 navigation array by pooling private clues and voting together.

## What works in this increment

- Create a six-character room code or join an existing room.
- Join with a callsign, without an account or installation.
- See the room roster and connection status update live for everyone in that room.
- Reconnect with a private browser token after a temporary disconnection.
- Launch when eight investigators are connected; rooms support up to ten.
- Receive a private clue and choose when to share it to the synced evidence board.
- Share and compare clues for four minutes, then vote for one of six crew suspects for one minute. Any private clues join the board when voting opens.
- Reveal the saboteur and team result; the host can start another case with the same crew.
- Rooms expire after 24 hours.

Everyone is an investigator. The saboteur is selected from the non-player expedition crew each round. Two forensic leads narrow the suspect list; comparing them reveals one unique suspect.

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
