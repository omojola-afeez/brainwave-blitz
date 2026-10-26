export const counters = {
  roomsCreated: 0,
  roomsDisposed: 0,
  playersJoined: 0,
  playersReconnected: 0,
  matchesStarted: 0,
  matchesCompleted: 0,
  messagesRejected: 0,
  joinsRejected: 0,
  rateLimited: 0,
  persistenceFailures: 0,
  persistenceSaved: 0,
  unexpectedErrors: 0,
};

export interface RoomProbe {
  code: string;
  playerCount: number;
  phase: string;
}

const rooms = new Set<() => RoomProbe>();

export function registerRoomProbe(probe: () => RoomProbe): () => void {
  rooms.add(probe);
  return () => rooms.delete(probe);
}

export function activeRoomCount(): number {
  return rooms.size;
}

export function snapshot() {
  let activePlayers = 0;
  const phases: Record<string, number> = {};
  for (const probe of rooms) {
    const r = probe();
    activePlayers += r.playerCount;
    phases[r.phase] = (phases[r.phase] ?? 0) + 1;
  }
  const mem = process.memoryUsage();
  return {
    uptimeSeconds: Math.round(process.uptime()),
    activeRooms: rooms.size,
    activePlayers,
    roomsByPhase: phases,
    counters: { ...counters },
    memoryMb: { rss: Math.round(mem.rss / 1e6), heapUsed: Math.round(mem.heapUsed / 1e6) },
  };
}
