import { useEffect, useState } from "react";
import { connectToRoom, createRoom, getSavedCredentials, type RoomConnection } from "./roomClient";
import type { CrewMember, RoomSnapshot } from "./protocol";

type LinkStatus = "connecting" | "connected" | "disconnected";

function App() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(0);
  const [status, setStatus] = useState<LinkStatus>("disconnected");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [connection, setConnection] = useState<RoomConnection | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => () => connection?.close(), [connection]);
  useEffect(() => {
    if (!snapshot?.deadlineAt) return;
    const interval = window.setInterval(() => setTick((current) => current + 1), 500);
    return () => window.clearInterval(interval);
  }, [snapshot?.deadlineAt, snapshot?.phase]);

  const receiveSnapshot = (next: RoomSnapshot) => {
    setSnapshot(next);
    setSnapshotReceivedAt(performance.now());
    setTick((current) => current + 1);
  };

  const joinRoom = (code: string) => {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Add your name so your crew knows who joined.");
      return;
    }
    setBusy(true);
    setError("");
    setRoomCode(code);

    const nextConnection = connectToRoom(code, cleanName, {
      onJoined: receiveSnapshot,
      onUpdate: receiveSnapshot,
      onError: (message) => {
        setError(message);
        setBusy(false);
      },
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus === "disconnected") setBusy(false);
      },
    });
    setConnection(nextConnection);
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

  const sendAction = (message: Parameters<RoomConnection["send"]>[0]) => {
    setError("");
    connection?.send(message);
  };

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
    connection?.close();
    setConnection(null);
    setSnapshot(null);
    setStatus("disconnected");
    setError("");
  };

  const myId = getSavedCredentials(roomCode)?.playerId;
  const me = snapshot?.players.find((player) => player.id === myId);
  const isHost = Boolean(me?.host);
  const connectedCount = snapshot?.players.filter((player) => player.connected).length ?? 0;
  const secondsLeft = tick >= 0 && snapshot?.deadlineAt
    ? Math.max(0, Math.ceil((snapshot.deadlineAt - snapshot.serverNow - (performance.now() - snapshotReceivedAt)) / 1000))
    : null;

  return (
    <main className="app-shell">
      <div className="starfield" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); returnToDock(); }}>
          <span className="brand-mark"><span /></span>
          <span>ORBITAL <b>STORIES</b></span>
        </a>
        <div className="topbar-right"><span className="signal-dot" /> CREW LINK <span className="signal-label">{status === "connected" ? "LIVE" : "READY"}</span></div>
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
                <div><span className="stat-label">ONE ROUND</span><strong>5 MIN</strong></div>
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
          <section className="lobby-card" aria-live="polite">
            <div className="lobby-head">
              <button className="back-button" onClick={returnToDock}>← LEAVE ROOM</button>
              <div className={`connection-status ${status}`}><span /> {status === "connected" ? "LIVE CONNECTION" : status === "connecting" ? "CONNECTING" : "RECONNECTING"}</div>
            </div>

            {snapshot.phase === "lobby" ? (
              <div className="lobby-main">
                <div className="lobby-copy">
                  <div className="eyebrow left"><span className="eyebrow-line" /> CREW ASSEMBLY</div>
                  <h1>YOU’RE ON<br /><em>THE SHIP.</em></h1>
                  <p>Share the room code. Once eight investigators are on board, your crew can launch the mission.</p>
                  <div className="room-code-box"><span>ROOM CODE</span><strong>{snapshot.code}</strong><button onClick={copyCode}>{copied ? "COPIED ✓" : "COPY CODE ↗"}</button></div>
                </div>
                <div className="crew-panel">
                  <div className="crew-panel-head"><div><span className="panel-kicker">CURRENT MANIFEST</span><h2>Expedition crew</h2></div><span className="crew-count">{connectedCount}<small> / {snapshot.capacity}</small></span></div>
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
                  <div className="lobby-action-row">
                    <span className="waiting-note"><span className="pulse-ring" /> {connectedCount < 8 ? `${8 - connectedCount} more investigators needed` : "Crew ready for launch"}</span>
                    {isHost ? <button className="primary-button launch-button" disabled={connectedCount < 8} onClick={() => sendAction({ type: "start" })}>LAUNCH MISSION <span>↗</span></button> : <span className="host-waiting">WAITING FOR HOST</span>}
                  </div>
                </div>
              </div>
            ) : (
              <GameRound
                snapshot={snapshot}
                isHost={isHost}
                secondsLeft={secondsLeft}
                error={error}
                onShareClue={() => sendAction({ type: "share_clue" })}
                onVote={(suspectId) => sendAction({ type: "vote", suspectId })}
                onNewRound={() => sendAction({ type: "new_round" })}
              />
            )}
          </section>
        )}
      </section>

      <footer className="footer"><span>ORBITAL STORIES <i>©</i> 2189</span><span>ALL HANDS. ONE TRUTH.</span></footer>
    </main>
  );
}

function GameRound({
  snapshot,
  isHost,
  secondsLeft,
  error,
  onShareClue,
  onVote,
  onNewRound,
}: {
  snapshot: RoomSnapshot;
  isHost: boolean;
  secondsLeft: number | null;
  error: string;
  onShareClue: () => void;
  onVote: (suspectId: string) => void;
  onNewRound: () => void;
}) {
  const suspects = snapshot.suspects ?? [];
  const sharedClues = snapshot.sharedClues ?? [];
  const timer = secondsLeft === null ? "—:—" : `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const culprit = suspects.find((suspect) => suspect.id === snapshot.culpritId);

  return (
    <div className="game-round">
      <div className="round-toolbar">
        <div><span className="panel-kicker">ROOM {snapshot.code}</span><div className="round-title">ATLAS-9 <span>/</span> NAVIGATION ARRAY SABOTAGE</div></div>
        <div className={`mission-clock ${snapshot.phase === "reveal" ? "clock-done" : ""}`}><span>{snapshot.phase === "investigation" ? "INVESTIGATION" : snapshot.phase === "voting" ? "FINAL VOTE" : "CASE REVEALED"}</span><strong>{timer}</strong></div>
      </div>
      <div className="phase-track" aria-label={`Mission phase: ${snapshot.phase}`}>
        <span className={snapshot.phase === "investigation" ? "active" : "complete"}>01 <b>SHARE CLUES</b></span><i className={snapshot.phase !== "investigation" ? "complete" : ""} />
        <span className={snapshot.phase === "voting" ? "active" : snapshot.phase === "reveal" ? "complete" : ""}>02 <b>VOTE TOGETHER</b></span><i className={snapshot.phase === "reveal" ? "complete" : ""} />
        <span className={snapshot.phase === "reveal" ? "active" : ""}>03 <b>REVEAL</b></span>
      </div>

      {snapshot.phase === "investigation" && (
        <div className="round-body">
          <section className="your-clue-panel">
            <div className="eyebrow left"><span className="eyebrow-line" /> PRIVATE TRANSMISSION</div>
            <h2>Your clue.</h2>
            <p className="round-instruction">Read it closely. Share it with the crew when you’re ready.</p>
            {snapshot.clue ? <ClueCardView clue={snapshot.clue} privateCard /> : <div className="clue-loading">Recovering your clue… reconnecting will restore it.</div>}
            <button className="primary-button share-button" disabled={!snapshot.clue || sharedClues.some((item) => item.playerId === getSavedCredentials(snapshot.code)?.playerId)} onClick={onShareClue}>
              {sharedClues.some((item) => item.playerId === getSavedCredentials(snapshot.code)?.playerId) ? "CLUE SHARED TO THE CREW ✓" : "SHARE CLUE WITH CREW"}
              <span className="button-arrow">↗</span>
            </button>
            <div className="round-hint"><span>✳</span> Everyone is an investigator. Any clue still private joins the board when voting opens.</div>
          </section>
          <div className="round-side">
            <EvidenceBoard clues={sharedClues} suspects={suspects} clueCapacity={snapshot.players.length} />
            <div className="side-note"><span className="pulse-ring" /> {sharedClues.length} OF {snapshot.players.length} CLUES SHARED <small>— compare the names that appear in both leads.</small></div>
          </div>
        </div>
      )}

      {snapshot.phase === "voting" && (
        <div className="vote-layout">
          <div className="vote-heading"><div><div className="eyebrow left"><span className="eyebrow-line" /> FINAL ACCUSATION</div><h2>Who sabotaged the array?</h2><p>Choose one crew member. Your vote locks in when submitted.</p></div><div className="vote-progress"><strong>{snapshot.votesCast ?? 0}<span> / {snapshot.players.filter((player) => player.connected).length}</span></strong><small>VOTES CAST</small></div></div>
          <div className="suspect-grid">
            {suspects.map((suspect, index) => (
              <button className="suspect-card" key={suspect.id} disabled={Boolean(snapshot.voteSubmitted)} onClick={() => onVote(suspect.id)}>
                <span className={`suspect-portrait avatar-${index % 5}`}>{suspect.name.split(" ").map((part) => part[0]).join("")}</span>
                <span className="suspect-info"><strong>{suspect.name}</strong><small>{suspect.role}</small></span>
                <span className="vote-chevron">→</span>
              </button>
            ))}
          </div>
          {snapshot.voteSubmitted && <div className="vote-locked"><span>✓</span> Your vote is locked. Waiting for the rest of your crew.</div>}
          <EvidenceBoard clues={sharedClues} suspects={suspects} clueCapacity={snapshot.players.length} compact />
        </div>
      )}

      {snapshot.phase === "reveal" && (
        <div className="reveal-layout">
          <div className={`reveal-banner ${snapshot.outcome === "success" ? "win" : "miss"}`}>
            <div><span className="panel-kicker">CASE FILE DECLASSIFIED</span><h2>{snapshot.outcome === "success" ? "THE CREW FOUND THE SABOTEUR." : "THE SABOTEUR SLIPPED AWAY."}</h2><p>{culprit ? `${culprit.name}, ${culprit.role.toLowerCase()}, disabled the Atlas-9 navigation array.` : "The evidence has been revealed."}</p></div>
            <span className="reveal-stamp">{snapshot.outcome === "success" ? "CASE\nCLOSED" : "CASE\nOPEN"}</span>
          </div>
          <div className="reveal-columns">
            <section><div className="panel-kicker">CREW VOTE TALLY</div><div className="tally-list">{suspects.map((suspect) => <div className={`tally-row ${suspect.id === snapshot.culpritId ? "is-culprit" : ""}`} key={suspect.id}><span>{suspect.name}{suspect.id === snapshot.culpritId && <small> SABOTEUR</small>}</span><strong>{snapshot.voteTally?.[suspect.id] ?? 0}</strong></div>)}</div></section>
            <EvidenceBoard clues={sharedClues} suspects={suspects} clueCapacity={snapshot.players.length} compact />
          </div>
          {isHost && <button className="primary-button next-round-button" onClick={onNewRound}>PREPARE ANOTHER CASE <span>↗</span></button>}
          {!isHost && <div className="host-waiting next-round-note">THE HOST CAN START ANOTHER CASE WHEN THE CREW IS READY.</div>}
        </div>
      )}
      {error && <p className="error-message round-error" role="alert">{error}</p>}
    </div>
  );
}

function ClueCardView({ clue, privateCard = false }: { clue: NonNullable<RoomSnapshot["clue"]>; privateCard?: boolean }) {
  return <article className={`clue-card ${clue.evidence ? "key-evidence" : ""} ${privateCard ? "private-clue" : ""}`}><div className="clue-card-kicker"><span>{clue.evidence ? "FORENSIC LEAD" : "SHIP LOG"}</span>{privateCard && <span>PRIVATE</span>}</div><h3>{clue.title}</h3><p>{clue.text}</p></article>;
}

function EvidenceBoard({ clues, suspects, clueCapacity, compact = false }: { clues: NonNullable<RoomSnapshot["sharedClues"]>; suspects: CrewMember[]; clueCapacity: number; compact?: boolean }) {
  return <section className={`evidence-board ${compact ? "compact" : ""}`}>
    <div className="crew-panel-head"><div><span className="panel-kicker">SHARED WITH THE CREW</span><h2>Evidence board</h2></div><span className="crew-count">{clues.length}<small> / {clueCapacity}</small></span></div>
    {clues.length ? <div className="shared-clue-list">{clues.map((item) => <div className="shared-clue" key={item.playerId}><div className="shared-from">{item.playerName.toUpperCase()} SHARED</div><ClueCardView clue={item.clue} /></div>)}</div> : <div className="empty-evidence"><span>⌁</span><p>No clues shared yet. Each investigator has a different piece of evidence.</p></div>}
    <div className="suspect-index"><span className="panel-kicker">CREW ON THE MANIFEST</span><div>{suspects.map((suspect) => <span key={suspect.id}>{suspect.name}</span>)}</div></div>
  </section>;
}

export default App;
