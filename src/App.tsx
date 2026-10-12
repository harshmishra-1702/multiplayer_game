import { useEffect, useState } from "react";
import { connectToRoom, createRoom } from "./roomClient";
import type { RoomSnapshot } from "./protocol";

type LinkStatus = "connecting" | "connected" | "disconnected";

function App() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState<LinkStatus>("disconnected");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [disconnect, setDisconnect] = useState<(() => void) | null>(null);

  useEffect(() => () => disconnect?.(), [disconnect]);

  const joinRoom = (code: string) => {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Add your name so your crew knows who joined.");
      return;
    }
    setBusy(true);
    setError("");
    setRoomCode(code);

    const closeSocket = connectToRoom(code, cleanName, {
      onJoined: (state) => {
        setSnapshot(state);
        setBusy(false);
      },
      onUpdate: setSnapshot,
      onError: (message) => {
        setError(message);
        setBusy(false);
      },
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus === "disconnected") setBusy(false);
      },
    });
    setDisconnect(() => closeSocket);
  };

  const onCreateRoom = async () => {
    if (!name.trim()) {
      setError("Add your name before creating a room.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      joinRoom(await createRoom());
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "Could not create a room right now.");
    }
  };

  const onJoinRoom = () => joinRoom(roomCode.trim().toUpperCase());

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copy isn’t available here. Share the code shown on screen.");
    }
  };

  const returnToDock = () => {
    disconnect?.();
    setDisconnect(null);
    setSnapshot(null);
    setStatus("disconnected");
    setError("");
  };

  return (
    <main className="app-shell">
      <div className="starfield" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); returnToDock(); }}>
          <span className="brand-mark"><span /></span>
          <span>ORBITAL <b>STORIES</b></span>
        </a>
        <div className="topbar-right"><span className="signal-dot" /> CREW LINK <span className="signal-label">READY</span></div>
      </header>

      <section className="content-wrap">
        {!snapshot ? (
          <div className="landing-grid">
            <section className="intro-panel">
              <div className="eyebrow"><span className="eyebrow-line" /> COOPERATIVE SPACE MYSTERY <span className="eyebrow-line" /></div>
              <h1>THE MISSION<br /><em>ISN’T ADDING UP.</em></h1>
              <p className="intro-copy">A sabotage has crippled the expedition. The crew has the clues. Put them together before the trail goes cold.</p>
              <div className="mission-stats">
                <div><span className="stat-label">CREW</span><strong>8—10</strong></div>
                <span className="stat-divider" />
                <div><span className="stat-label">ONE ROUND</span><strong>~5 MIN</strong></div>
                <span className="stat-divider" />
                <div><span className="stat-label">MISSION TYPE</span><strong>TEAMWORK</strong></div>
              </div>
              <div className="transmission">
                <span className="transmission-icon">⌁</span>
                <div><b>INCOMING TRANSMISSION</b><p>“Someone aboard knew exactly which wire to cut.”</p></div>
              </div>
            </section>

            <section className="access-card" aria-labelledby="access-title">
              <div className="card-topline"><span>MISSION ACCESS</span><span className="secure-label"><span /> OPEN CREW CHANNEL</span></div>
              <h2 id="access-title">Join your crew.</h2>
              <p className="card-intro">No account. No downloads. Just a name and a room code.</p>
              <label className="field-label" htmlFor="crew-name">YOUR CALLSIGN</label>
              <input id="crew-name" autoComplete="nickname" maxLength={20} placeholder="e.g. Nova" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onJoinRoom(); }} />
              <button className="primary-button" onClick={onCreateRoom} disabled={busy}>
                <span className="button-orbit">✳</span>{busy ? "CONTACTING MISSION CONTROL…" : "CREATE A NEW ROOM"}<span className="button-arrow">↗</span>
              </button>
              <div className="or-divider"><span /> OR JOIN AN EXISTING CREW <span /></div>
              <label className="field-label" htmlFor="room-code">ROOM CODE</label>
              <div className="code-row">
                <input id="room-code" className="code-input" maxLength={6} autoCapitalize="characters" autoCorrect="off" placeholder="ABC123" value={roomCode} onChange={(event) => setRoomCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") onJoinRoom(); }} />
                <button className="join-button" onClick={onJoinRoom} disabled={busy || roomCode.trim().length !== 6}>JOIN ROOM <span>→</span></button>
              </div>
              {error && <p className="error-message" role="alert">{error}</p>}
              <div className="privacy-note"><span>◈</span> Your crew link is private to your room.</div>
            </section>
          </div>
        ) : (
          <section className="lobby-card">
            <div className="lobby-head">
              <button className="back-button" onClick={returnToDock}>← BACK TO DOCK</button>
              <div className={`connection-status ${status}`}><span /> {status === "connected" ? "LIVE CONNECTION" : status === "connecting" ? "CONNECTING" : "RECONNECTING"}</div>
            </div>
            <div className="lobby-main">
              <div className="lobby-copy">
                <div className="eyebrow left"><span className="eyebrow-line" /> CREW ASSEMBLY</div>
                <h1>YOU’RE ON<br /><em>THE SHIP.</em></h1>
                <p>Your crew is gathering. Share the room code so the rest of your investigators can come aboard.</p>
                <div className="room-code-box"><span>ROOM CODE</span><strong>{snapshot.code}</strong><button onClick={copyCode}>{copied ? "COPIED ✓" : "COPY CODE ↗"}</button></div>
              </div>
              <div className="crew-panel">
                <div className="crew-panel-head"><div><span className="panel-kicker">CURRENT MANIFEST</span><h2>Expedition crew</h2></div><span className="crew-count">{snapshot.players.length}<small> / {snapshot.capacity}</small></span></div>
                <div className="crew-list">
                  {snapshot.players.map((player, index) => (
                    <div className="crew-member" key={player.id}>
                      <span className={`avatar avatar-${index % 5}`}>{player.name.trim().slice(0, 1).toUpperCase()}</span>
                      <span className="crew-name">{player.name}{player.host && <small> HOST</small>}</span>
                      <span className={`member-status ${player.connected ? "online" : "offline"}`}><i />{player.connected ? "ON BOARD" : "AWAY"}</span>
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, 4 - snapshot.players.length) }, (_, index) => (
                    <div className="crew-member empty-slot" key={`empty-${index}`}><span className="avatar empty-avatar">＋</span><span className="crew-name">Awaiting investigator</span><span className="member-status">OPEN SLOT</span></div>
                  ))}
                </div>
                <div className="waiting-note"><span className="pulse-ring" /> Lobby sync is live. Invite the rest of your crew to continue.</div>
              </div>
            </div>
            {error && <p className="error-message lobby-error" role="alert">{error}</p>}
          </section>
        )}
      </section>

      <footer className="footer"><span>ORBITAL STORIES <i>©</i> 2189</span><span>ALL HANDS. ONE TRUTH.</span></footer>
    </main>
  );
}

export default App;
