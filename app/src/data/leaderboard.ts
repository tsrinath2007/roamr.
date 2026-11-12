export interface ExplorerLevelInfo {
  level: number;
  title: string;
  floor: number;
  next: number;
  nextTitle: string;
}

export function getExplorerLevel(xp: number): ExplorerLevelInfo {
  if (xp < 100) {
    return { level: 1, title: 'Wanderer', floor: 0, next: 100, nextTitle: 'Explorer' };
  }
  if (xp < 250) {
    return { level: 2, title: 'Explorer', floor: 100, next: 250, nextTitle: 'Pathfinder' };
  }
  if (xp < 500) {
    return { level: 3, title: 'Pathfinder', floor: 250, next: 500, nextTitle: 'Trailblazer' };
  }
  const extraLevels = Math.floor((xp - 500) / 300);
  const floor = 500 + extraLevels * 300;
  return {
    level: 4 + extraLevels,
    title: 'Trailblazer',
    floor,
    next: floor + 300,
    nextTitle: `Level ${5 + extraLevels}`,
  };
}

export interface RemoteExplorerRow {
  id: string;
  name: string;
  city: string;
  xp: number;
  stampsCount: number;
  avatar?: string;
}

export interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  city: string;
  xp: number;
  stampsCount: number;
  levelTitle: string;
  avatar?: string;
  isCurrentUser?: boolean;
}

/**
 * Ranks only real explorer profiles loaded from Supabase `profiles` plus the
 * active user's live local XP/stamps count (zero mock/fake entries).
 */
export function buildRealExplorerLeaderboard(params: {
  remoteExplorers: RemoteExplorerRow[];
  currentUserId?: string;
  userName?: string;
  userAvatar?: string;
  userCity: string;
  totalXp: number;
  stampsCount: number;
  scope?: 'city' | 'global';
}): {
  entries: LeaderboardEntry[];
  currentUserRank: number;
  xpToAbove: number;
  nextRival?: LeaderboardEntry;
} {
  const {
    remoteExplorers,
    currentUserId,
    userName,
    userAvatar,
    userCity,
    totalXp,
    stampsCount,
    scope = 'global',
  } = params;
  const normalizedCity = (userCity || '').trim().toLowerCase();

  const others = remoteExplorers
    .filter((row) => row.id !== currentUserId)
    .filter((row) =>
      scope === 'city' && normalizedCity ? row.city.trim().toLowerCase() === normalizedCity : true
    )
    .map((row) => ({
      ...row,
      levelTitle: getExplorerLevel(row.xp).title,
      isCurrentUser: false,
    }));

  const currentUserEntry = {
    id: currentUserId || 'current-explorer',
    name: userName?.trim() || 'You',
    city: userCity || 'Local',
    xp: totalXp,
    stampsCount,
    levelTitle: getExplorerLevel(totalXp).title,
    avatar: userAvatar,
    isCurrentUser: true,
  };

  const combined = [...others, currentUserEntry];

  combined.sort((a, b) => {
    if (b.xp !== a.xp) return b.xp - a.xp;
    if (b.stampsCount !== a.stampsCount) return b.stampsCount - a.stampsCount;
    return a.isCurrentUser ? -1 : b.isCurrentUser ? 1 : 0;
  });

  const entries: LeaderboardEntry[] = combined.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));

  const currentIdx = entries.findIndex((e) => e.isCurrentUser);
  const currentUserRank = currentIdx >= 0 ? entries[currentIdx].rank : 1;
  const nextRival = currentIdx > 0 ? entries[currentIdx - 1] : undefined;
  const xpToAbove = nextRival ? Math.max(0, nextRival.xp - totalXp) : 0;

  return {
    entries,
    currentUserRank,
    xpToAbove,
    nextRival,
  };
}
