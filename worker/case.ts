import type { ClueCard, CrewMember } from "../src/protocol";

export const CREW: CrewMember[] = [
  { id: "captain-vale", name: "Imani Vale", role: "Expedition commander" },
  { id: "engineer-park", name: "Jun Park", role: "Chief engineer" },
  { id: "pilot-solano", name: "Ren Solano", role: "Flight pilot" },
  { id: "scientist-raman", name: "Asha Raman", role: "Xenobiologist" },
  { id: "medic-okafor", name: "Tavi Okafor", role: "Medical officer" },
  { id: "navigator-venn", name: "Luca Venn", role: "Navigator" },
];

const TOOLMARK_PAIRS = [
  ["engineer-park", "pilot-solano"],
  ["scientist-raman", "medic-okafor"],
  ["navigator-venn", "captain-vale"],
];

const ACCESS_PAIRS = [
  ["engineer-park", "scientist-raman"],
  ["pilot-solano", "navigator-venn"],
  ["medic-okafor", "captain-vale"],
];

const BACKGROUND_CLUES: ClueCard[] = [
  { id: "clock-drift", title: "A drifting clock", text: "The array failed at 21:38 ship time. The ship clock lost three minutes during the same window." },
  { id: "silent-alarm", title: "A silent alarm", text: "The emergency alarm sounded ninety seconds after the navigation array went dark." },
  { id: "no-docking", title: "No visitors", text: "The outer airlock reports no docking or hull breach during the night watch." },
  { id: "backup-map", title: "The backup map", text: "A clean copy of the previous navigation map survived in the isolated black box." },
  { id: "sealed-hatch", title: "An intact seal", text: "The engine corridor pressure seal was intact after the incident. No one entered from outside." },
  { id: "manual-override", title: "Manual override", text: "The system was switched to manual control just before the navigation array shut down." },
  { id: "cold-panel", title: "A cold panel", text: "The access panel was cool to the touch when the first responder arrived. The sabotage had not been running long." },
  { id: "quiet-watch", title: "A quiet watch", text: "The rest of the ship stayed on routine power. Only the navigation array was deliberately disabled." },
];

function pickIndex(length: number) {
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return value % length;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function namesFor(ids: string[]) {
  return ids.map((id) => CREW.find((member) => member.id === id)?.name ?? "Unknown crew member").join(" and ");
}

export function createCase(playerIds: string[]) {
  const culprit = CREW[pickIndex(CREW.length)];
  const toolPair = TOOLMARK_PAIRS.find((pair) => pair.includes(culprit.id))!;
  const accessPair = ACCESS_PAIRS.find((pair) => pair.includes(culprit.id))!;
  const evidence: ClueCard[] = [
    {
      id: "toolmark",
      title: "The toolmark",
      text: `A magnetic crescent was cut into the navigation array's cover. The mark matches equipment issued to ${namesFor(toolPair)}.`,
      evidence: true,
    },
    {
      id: "access-audit",
      title: "The access audit",
      text: `A split service code opened the panel during the blackout. Its access records narrow it to ${namesFor(accessPair)}.`,
      evidence: true,
    },
  ];
  const contextClues = shuffle(BACKGROUND_CLUES).slice(0, playerIds.length - evidence.length);
  const deck = shuffle([...evidence, ...contextClues]);
  const cluesByPlayerId: Record<string, ClueCard> = {};
  playerIds.forEach((playerId, index) => { cluesByPlayerId[playerId] = deck[index]; });

  return { culpritId: culprit.id, cluesByPlayerId, suspects: CREW };
}
