import type { ClubPlayerItem, SbcChallenge, StoragePileItem } from "../api/sbcSets";

const DEFAULT_ON_PITCH_COUNT = 11;
const HARD_AVOID_OVR = 90;

type InventoryPlayer = (ClubPlayerItem | StoragePileItem) & {
  source: "club" | "storage";
};

type RequirementGroup = {
  slot: number;
  minCount: number;
  nationIds: Set<number>;
  leagueIds: Set<number>;
  clubIds: Set<number>;
  quality?: number;
  rarityGroup?: number;
  playerLevel?: number;
};

type ParsedConstraints = {
  teamRatingMin?: number;
  maxSameNation?: number;
  maxSameLeague?: number;
  maxSameClub?: number;
  minUniqueLeagues?: number;
  minUniqueClubs?: number;
  groups: RequirementGroup[];
};

type Candidate = {
  player: InventoryPlayer;
  score: number;
  rating: number;
};

export type EconomySbcSolveInput = {
  challenge?: SbcChallenge;
  clubPlayers: ClubPlayerItem[];
  storagePlayers: StoragePileItem[];
  onPitchCount?: number;
};

export type EconomySbcSolveResult = {
  playerIds: number[];
  summary: string;
};

const asPositiveInt = (value: unknown) => {
  const normalized = Math.trunc(Number(value));
  if (!Number.isFinite(normalized) || normalized <= 0) return undefined;
  return normalized;
};

const resolvePlayerRating = (player: InventoryPlayer) => {
  const rating = Math.trunc(Number(player.rating ?? 0));
  return Number.isFinite(rating) && rating > 0 ? rating : 0;
};

const resolveMarketValue = (player: InventoryPlayer) => {
  const marketAverage = Number(player.marketAverage);
  if (Number.isFinite(marketAverage) && marketAverage > 0) return marketAverage;
  const marketDataMinPrice = Number(player.marketDataMinPrice);
  if (Number.isFinite(marketDataMinPrice) && marketDataMinPrice > 0) return marketDataMinPrice;
  const rating = resolvePlayerRating(player);
  if (rating > 0) return rating * 130;
  return 4_000;
};

const isPlayerAvailable = (player: ClubPlayerItem | StoragePileItem) => {
  if (player.itemType && player.itemType !== "player") return false;
  const id = asPositiveInt(player.id);
  if (!id) return false;
  const state = String(player.itemState ?? "free").trim().toLowerCase();
  if (state && state !== "free") return false;
  return true;
};

const buildPlayerPool = (clubPlayers: ClubPlayerItem[], storagePlayers: StoragePileItem[]) => {
  const pool: InventoryPlayer[] = [];
  for (const player of clubPlayers) {
    if (!isPlayerAvailable(player)) continue;
    pool.push({
      ...player,
      source: "club",
    });
  }
  for (const player of storagePlayers) {
    if (!isPlayerAvailable(player)) continue;
    pool.push({
      ...player,
      source: "storage",
    });
  }
  return pool;
};

const parseConstraints = (challenge?: SbcChallenge): ParsedConstraints => {
  const groupsBySlot = new Map<number, RequirementGroup>();
  const parsed: ParsedConstraints = {
    groups: [],
  };

  const requirements = Array.isArray(challenge?.elgReq) ? challenge?.elgReq : [];
  for (const rawReq of requirements) {
    if (!rawReq || typeof rawReq !== "object") continue;
    const req = rawReq as Record<string, unknown>;
    const type = String(req.type ?? "").trim().toUpperCase();
    if (!type || type === "SCOPE") continue;
    const value = asPositiveInt(req.eligibilityValue);
    if (!value) continue;
    const slot = asPositiveInt(req.eligibilitySlot) ?? 0;

    const ensureSlot = () => {
      const existing = groupsBySlot.get(slot);
      if (existing) return existing;
      const created: RequirementGroup = {
        slot,
        minCount: 0,
        nationIds: new Set<number>(),
        leagueIds: new Set<number>(),
        clubIds: new Set<number>(),
      };
      groupsBySlot.set(slot, created);
      return created;
    };

    if (type === "TEAM_RATING_1_TO_100") {
      parsed.teamRatingMin = Math.max(parsed.teamRatingMin ?? 0, value);
      continue;
    }
    if (type === "SAME_NATION_COUNT") {
      parsed.maxSameNation = parsed.maxSameNation ? Math.min(parsed.maxSameNation, value) : value;
      continue;
    }
    if (type === "SAME_LEAGUE_COUNT") {
      parsed.maxSameLeague = parsed.maxSameLeague ? Math.min(parsed.maxSameLeague, value) : value;
      continue;
    }
    if (type === "SAME_CLUB_COUNT") {
      parsed.maxSameClub = parsed.maxSameClub ? Math.min(parsed.maxSameClub, value) : value;
      continue;
    }
    if (type === "LEAGUE_COUNT") {
      parsed.minUniqueLeagues = Math.max(parsed.minUniqueLeagues ?? 0, value);
      continue;
    }
    if (type === "CLUB_COUNT") {
      parsed.minUniqueClubs = Math.max(parsed.minUniqueClubs ?? 0, value);
      continue;
    }

    const group = ensureSlot();
    if (type === "PLAYER_COUNT") {
      group.minCount = Math.max(group.minCount, value);
      continue;
    }
    if (type === "NATION_ID") {
      group.nationIds.add(value);
      continue;
    }
    if (type === "LEAGUE_ID") {
      group.leagueIds.add(value);
      continue;
    }
    if (type === "CLUB_ID") {
      group.clubIds.add(value);
      continue;
    }
    if (type === "PLAYER_QUALITY") {
      group.quality = value;
      continue;
    }
    if (type === "PLAYER_RARITY_GROUP") {
      group.rarityGroup = value;
      continue;
    }
    if (type === "PLAYER_LEVEL") {
      group.playerLevel = value;
      continue;
    }
  }

  for (const group of groupsBySlot.values()) {
    const hasFilter =
      group.nationIds.size > 0 ||
      group.leagueIds.size > 0 ||
      group.clubIds.size > 0 ||
      group.quality !== undefined ||
      group.rarityGroup !== undefined ||
      group.playerLevel !== undefined;
    if (!hasFilter && group.minCount <= 0) continue;
    if (group.minCount <= 0 && hasFilter) group.minCount = 1;
    parsed.groups.push(group);
  }

  return parsed;
};

const resolveQualityBand = (player: InventoryPlayer) => {
  const rating = resolvePlayerRating(player);
  if (rating >= 75) return 2; // gold
  if (rating >= 65) return 1; // silver
  return 0; // bronze
};

const matchesRarityGroup = (player: InventoryPlayer, requiredGroup: number | undefined) => {
  if (!requiredGroup) return true;
  const groups = Array.isArray(player.groups) ? player.groups : [];
  if (groups.includes(requiredGroup)) return true;
  if (requiredGroup === 4) return Number(player.rareflag ?? 0) > 0;
  return false;
};

const matchesPlayerLevel = (player: InventoryPlayer, requiredLevel: number | undefined) => {
  if (!requiredLevel) return true;
  // Common SBC mapping: 1 bronze, 2 silver, 3 gold.
  if (requiredLevel === 3) return resolvePlayerRating(player) >= 75;
  if (requiredLevel === 2) {
    const rating = resolvePlayerRating(player);
    return rating >= 65 && rating < 75;
  }
  if (requiredLevel === 1) return resolvePlayerRating(player) < 65;
  return true;
};

const matchesQuality = (player: InventoryPlayer, requiredQuality: number | undefined) => {
  if (requiredQuality === undefined) return true;
  return resolveQualityBand(player) === requiredQuality;
};

const matchesRequirementGroup = (player: InventoryPlayer, group: RequirementGroup) => {
  if (group.nationIds.size > 0 && !group.nationIds.has(Math.trunc(Number(player.nation)))) return false;
  if (group.leagueIds.size > 0 && !group.leagueIds.has(Math.trunc(Number(player.leagueId)))) return false;
  if (group.clubIds.size > 0 && !group.clubIds.has(Math.trunc(Number(player.teamid)))) return false;
  if (!matchesQuality(player, group.quality)) return false;
  if (!matchesRarityGroup(player, group.rarityGroup)) return false;
  if (!matchesPlayerLevel(player, group.playerLevel)) return false;
  return true;
};

const scorePlayer = (player: InventoryPlayer, teamRatingMin: number | undefined) => {
  const rating = resolvePlayerRating(player);
  let score = resolveMarketValue(player);

  if (player.untradeable) score *= 0.55;
  if (!player.untradeable) score *= 1.15;
  if (player.source === "storage") score *= 0.88;

  const rareflag = Number(player.rareflag ?? 0);
  const subtype = Number(player.cardsubtypeid ?? 0);
  if (rareflag >= 3) score += 18_000;
  if (subtype >= 3) score += 12_000;
  if (rating >= HARD_AVOID_OVR) score += 100_000;

  const minRating = teamRatingMin ?? 0;
  if (minRating > 0) {
    const softCap = minRating + 1;
    if (rating > softCap) {
      const delta = rating - softCap;
      score += delta * delta * 2_200;
    }
  }

  return score;
};

const countMatchesInSelection = (selection: Candidate[], group: RequirementGroup) =>
  selection.reduce((sum, item) => sum + (matchesRequirementGroup(item.player, group) ? 1 : 0), 0);

const validateGroupMinimums = (selection: Candidate[], groups: RequirementGroup[]) =>
  groups.every((group) => countMatchesInSelection(selection, group) >= group.minCount);

const ratingAverage = (selection: Candidate[]) => {
  if (selection.length === 0) return 0;
  const total = selection.reduce((sum, item) => sum + item.rating, 0);
  return total / selection.length;
};

const countBy = (selection: Candidate[], pick: (item: Candidate) => number | undefined) => {
  const map = new Map<number, number>();
  for (const item of selection) {
    const key = Math.trunc(Number(pick(item)));
    if (!Number.isFinite(key) || key <= 0) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
};

const ensureMaxSame = (
  selection: Candidate[],
  allCandidates: Candidate[],
  usedIds: Set<number>,
  maxCount: number | undefined,
  keyPick: (item: Candidate) => number | undefined,
  groups: RequirementGroup[],
) => {
  if (!maxCount || maxCount <= 0) return;
  let guard = 0;
  while (guard < 60) {
    guard += 1;
    const counts = countBy(selection, keyPick);
    const over = [...counts.entries()].find(([, count]) => count > maxCount);
    if (!over) break;
    const [overKey] = over;

    const removable = selection
      .map((item, idx) => ({ item, idx }))
      .filter((entry) => Math.trunc(Number(keyPick(entry.item))) === overKey)
      .sort((a, b) => b.item.score - a.item.score);
    if (removable.length === 0) break;

    const replaceIdx = removable[0].idx;
    const current = selection[replaceIdx];
    const candidate = allCandidates
      .filter((entry) => !usedIds.has(entry.player.id))
      .filter((entry) => Math.trunc(Number(keyPick(entry))) !== overKey)
      .sort((a, b) => a.score - b.score)
      .find((entry) => {
        const next = [...selection];
        next[replaceIdx] = entry;
        return validateGroupMinimums(next, groups);
      });

    if (!candidate) break;
    usedIds.delete(current.player.id);
    usedIds.add(candidate.player.id);
    selection[replaceIdx] = candidate;
  }
};

const ensureUniqueMinimum = (
  selection: Candidate[],
  allCandidates: Candidate[],
  usedIds: Set<number>,
  minUnique: number | undefined,
  keyPick: (item: Candidate) => number | undefined,
  groups: RequirementGroup[],
) => {
  if (!minUnique || minUnique <= 1) return;
  let guard = 0;
  while (guard < 60) {
    guard += 1;
    const keys = new Set<number>();
    for (const item of selection) {
      const key = Math.trunc(Number(keyPick(item)));
      if (Number.isFinite(key) && key > 0) keys.add(key);
    }
    if (keys.size >= minUnique) break;

    const candidate = allCandidates
      .filter((entry) => !usedIds.has(entry.player.id))
      .filter((entry) => {
        const key = Math.trunc(Number(keyPick(entry)));
        return Number.isFinite(key) && key > 0 && !keys.has(key);
      })
      .sort((a, b) => a.score - b.score)[0];
    if (!candidate) break;

    const removable = selection
      .map((item, idx) => ({ item, idx }))
      .sort((a, b) => b.item.score - a.item.score)
      .find((entry) => {
        const next = [...selection];
        next[entry.idx] = candidate;
        return validateGroupMinimums(next, groups);
      });
    if (!removable) break;

    usedIds.delete(removable.item.player.id);
    usedIds.add(candidate.player.id);
    selection[removable.idx] = candidate;
  }
};

const ensureTeamRating = (
  selection: Candidate[],
  allCandidates: Candidate[],
  usedIds: Set<number>,
  minRating: number | undefined,
  groups: RequirementGroup[],
) => {
  if (!minRating || minRating <= 0 || selection.length === 0) return;
  let guard = 0;
  while (guard < 120) {
    guard += 1;
    if (ratingAverage(selection) >= minRating) break;

    let bestSwap:
      | {
          removeIdx: number;
          add: Candidate;
          score: number;
        }
      | undefined;

    for (let idx = 0; idx < selection.length; idx += 1) {
      const current = selection[idx];
      for (const candidate of allCandidates) {
        if (usedIds.has(candidate.player.id)) continue;
        if (candidate.rating <= current.rating) continue;

        const next = [...selection];
        next[idx] = candidate;
        if (!validateGroupMinimums(next, groups)) continue;
        const nextAvg = ratingAverage(next);
        if (nextAvg <= ratingAverage(selection)) continue;

        const overkill = Math.max(0, candidate.rating - ((minRating ?? 0) + 1));
        const swapScore = (candidate.score - current.score) + overkill * 2_000;
        if (!bestSwap || swapScore < bestSwap.score) {
          bestSwap = {
            removeIdx: idx,
            add: candidate,
            score: swapScore,
          };
        }
      }
    }

    if (!bestSwap) break;
    const removed = selection[bestSwap.removeIdx];
    usedIds.delete(removed.player.id);
    usedIds.add(bestSwap.add.player.id);
    selection[bestSwap.removeIdx] = bestSwap.add;
  }
};

export const solveEconomySbcPlayers = (input: EconomySbcSolveInput): EconomySbcSolveResult => {
  const onPitchCount = Math.max(1, Math.trunc(input.onPitchCount ?? DEFAULT_ON_PITCH_COUNT));
  const pool = buildPlayerPool(input.clubPlayers, input.storagePlayers);
  if (pool.length === 0) {
    return {
      playerIds: [],
      summary: "No available players in club/storage",
    };
  }

  const constraints = parseConstraints(input.challenge);
  const scored = pool
    .map<Candidate>((player) => ({
      player,
      score: scorePlayer(player, constraints.teamRatingMin),
      rating: resolvePlayerRating(player),
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.rating !== b.rating) return a.rating - b.rating;
      return a.player.id - b.player.id;
    });

  const selected: Candidate[] = [];
  const usedIds = new Set<number>();
  const targetCount = Math.min(onPitchCount, scored.length);

  const groups = [...constraints.groups].sort((a, b) => {
    const aCount = scored.filter((item) => matchesRequirementGroup(item.player, a)).length;
    const bCount = scored.filter((item) => matchesRequirementGroup(item.player, b)).length;
    return aCount - bCount;
  });

  for (const group of groups) {
    if (selected.length >= targetCount) break;
    const need = Math.max(0, group.minCount - countMatchesInSelection(selected, group));
    if (need <= 0) continue;
    const candidates = scored.filter(
      (item) => !usedIds.has(item.player.id) && matchesRequirementGroup(item.player, group),
    );
    const takeCount = Math.min(need, candidates.length, targetCount - selected.length);
    for (let idx = 0; idx < takeCount; idx += 1) {
      const picked = candidates[idx];
      usedIds.add(picked.player.id);
      selected.push(picked);
    }
  }

  if (selected.length < targetCount) {
    for (const candidate of scored) {
      if (selected.length >= targetCount) break;
      if (usedIds.has(candidate.player.id)) continue;
      usedIds.add(candidate.player.id);
      selected.push(candidate);
    }
  }

  ensureMaxSame(selected, scored, usedIds, constraints.maxSameNation, (item) => item.player.nation, groups);
  ensureMaxSame(selected, scored, usedIds, constraints.maxSameLeague, (item) => item.player.leagueId, groups);
  ensureMaxSame(selected, scored, usedIds, constraints.maxSameClub, (item) => item.player.teamid, groups);

  ensureUniqueMinimum(
    selected,
    scored,
    usedIds,
    constraints.minUniqueLeagues,
    (item) => item.player.leagueId,
    groups,
  );
  ensureUniqueMinimum(
    selected,
    scored,
    usedIds,
    constraints.minUniqueClubs,
    (item) => item.player.teamid,
    groups,
  );

  ensureTeamRating(selected, scored, usedIds, constraints.teamRatingMin, groups);

  const playerIds = selected.map((item) => item.player.id);
  const avg = ratingAverage(selected);
  const summary = `Selected ${playerIds.length}/${targetCount} players, avg OVR ${avg.toFixed(1)}`;
  return {
    playerIds,
    summary,
  };
};

