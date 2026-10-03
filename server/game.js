import crypto from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createId(length = 6) {
  const bytes = crypto.randomBytes(length);
  let id = "";
  for (let i = 0; i < length; i += 1) id += alphabet[bytes[i] % alphabet.length];
  return id;
}

export function createHostToken() {
  return crypto.randomBytes(24).toString("hex");
}

function cleanNames(rawNames) {
  if (!Array.isArray(rawNames)) throw new Error("Укажите имена игроков");
  const names = rawNames.map((name) => String(name ?? "").trim()).filter(Boolean);
  if (names.length < 2) throw new Error("Нужно минимум два игрока");
  if (names.length > 24) throw new Error("Слишком много игроков");
  const seen = new Set();
  for (const name of names) {
    if (name.length > 40) throw new Error("Слишком длинное имя");
    const key = name.toLocaleLowerCase("ru");
    if (seen.has(key)) throw new Error(`Имя «${name}» повторяется`);
    seen.add(key);
  }
  return names;
}

export function createGame(rawNames) {
  const names = cleanNames(rawNames);
  return {
    id: createId(),
    hostToken: createHostToken(),
    phase: "lobby",
    players: names.map((name) => ({
      id: crypto.randomUUID(),
      name,
      alive: true,
      sessionId: null,
      avatar: null,
    })),
    votes: {},
    revoteIds: null,
    spectators: new Set(),
  };
}

function mustPlayer(game, playerId) {
  const player = game.players.find((item) => item.id === playerId);
  if (!player) throw new Error("Игрок не найден");
  return player;
}

export function playerBySession(game, sessionId) {
  if (!sessionId) return null;
  return game.players.find((player) => player.sessionId === sessionId) ?? null;
}

function assertLobby(game) {
  if (game.phase !== "lobby") throw new Error("Игра уже началась");
}

function spectatorsOf(game) {
  if (!game.spectators) game.spectators = new Set();
  return game.spectators;
}

export function isSpectator(game, sessionId) {
  return Boolean(sessionId && spectatorsOf(game).has(sessionId));
}

export function spectate(game, sessionId) {
  if (!sessionId || typeof sessionId !== "string") throw new Error("Нет сессии");
  if (playerBySession(game, sessionId)) throw new Error("Сначала смените имя");
  spectatorsOf(game).add(sessionId);
}

export function leaveSpectate(game, sessionId) {
  assertLobby(game);
  if (!isSpectator(game, sessionId)) throw new Error("Вы не наблюдаете");
  spectatorsOf(game).delete(sessionId);
}

export function claim(game, sessionId, playerId) {
  assertLobby(game);
  if (!sessionId || typeof sessionId !== "string") throw new Error("Нет сессии");
  if (isSpectator(game, sessionId)) throw new Error("Сначала выйдите из наблюдения");
  const mine = playerBySession(game, sessionId);
  if (mine) throw new Error("Сначала смените имя");
  const player = mustPlayer(game, playerId);
  if (player.sessionId) throw new Error("Это имя уже занято");
  player.sessionId = sessionId;
}

export function release(game, sessionId) {
  assertLobby(game);
  const mine = playerBySession(game, sessionId);
  if (!mine) throw new Error("Имя ещё не выбрано");
  mine.sessionId = null;
}

export function freeSeat(game, playerId) {
  assertLobby(game);
  mustPlayer(game, playerId).sessionId = null;
}

export function startGame(game) {
  assertLobby(game);
  if (game.players.some((player) => !player.sessionId)) {
    throw new Error("Ещё не все выбрали имена");
  }
  game.phase = "day";
}

function alivePlayers(game) {
  return game.players.filter((player) => player.alive);
}

export function canTarget(game, voter, target) {
  if (!voter?.alive || !target?.alive) return false;
  if (voter.id === target.id) return false;
  if (game.revoteIds && !game.revoteIds.includes(target.id)) return false;
  return true;
}

export function legalTargets(game, voter) {
  return game.players.filter((target) => canTarget(game, voter, target));
}

function mustVote(game, player) {
  return player.alive && legalTargets(game, player).length > 0;
}

export function beginVote(game) {
  if (game.phase !== "day") throw new Error("Сейчас нельзя начать голосование");
  if (alivePlayers(game).length < 2) throw new Error("Недостаточно живых игроков");
  game.phase = "voting";
  game.votes = {};
  game.revoteIds = null;
}

export function castVote(game, voterId, targetId) {
  if (game.phase !== "voting") throw new Error("Голосование закрыто");
  const voter = mustPlayer(game, voterId);
  const target = mustPlayer(game, targetId);
  if (!voter.alive) throw new Error("Этот игрок не может голосовать");
  if (!canTarget(game, voter, target)) throw new Error("За этого игрока голосовать нельзя");
  game.votes[voterId] = targetId;
}

const AVATAR_LIMIT = 100_000;

export function setAvatar(game, playerId, avatar) {
  if (game.phase === "voting") throw new Error("Сейчас нельзя сменить фото");
  const player = mustPlayer(game, playerId);
  if (!player.alive) throw new Error("Выбывший игрок не меняет фото");
  if (avatar == null || avatar === "") {
    player.avatar = null;
    return;
  }
  if (typeof avatar !== "string" || !/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(avatar)) {
    throw new Error("Нужна картинка");
  }
  if (avatar.length > AVATAR_LIMIT) throw new Error("Слишком большая картинка");
  player.avatar = avatar;
}

function voteCounts(game) {
  const counts = new Map(game.players.map((player) => [player.id, 0]));
  for (const targetId of Object.values(game.votes)) {
    if (counts.has(targetId)) counts.set(targetId, counts.get(targetId) + 1);
  }
  return counts;
}

export function leadersOf(game) {
  const counts = voteCounts(game);
  let max = 0;
  for (const player of alivePlayers(game)) max = Math.max(max, counts.get(player.id) || 0);
  if (max === 0) return [];
  return alivePlayers(game).filter((player) => counts.get(player.id) === max);
}

export function allRequiredVoted(game) {
  const required = game.players.filter((player) => mustVote(game, player));
  return required.length > 0 && required.every((player) => Boolean(game.votes[player.id]));
}

export function canRevote(game) {
  return game.phase === "voting" && allRequiredVoted(game) && leadersOf(game).length >= 2;
}

export function describeOutcome(game) {
  const leaders = leadersOf(game);
  if (leaders.length === 1) return { kind: "prison", name: leaders[0].name, names: [leaders[0].name] };
  if (leaders.length > 1) return { kind: "tie", name: null, names: leaders.map((player) => player.name) };
  return { kind: "empty", name: null, names: [] };
}

export function beginRevote(game) {
  if (!canRevote(game)) throw new Error("Переголосование сейчас недоступно");
  game.revoteIds = leadersOf(game).map((player) => player.id);
  game.votes = {};
}

export function endVote(game) {
  if (game.phase !== "voting") throw new Error("Голосование не идёт");
  const outcome = describeOutcome(game);
  if (outcome.kind === "prison") {
    const player = game.players.find((item) => item.name === outcome.name);
    player.alive = false;
  }
  game.votes = {};
  game.revoteIds = null;
  game.phase = "day";
  if (outcome.kind === "prison") return { type: "prison", name: outcome.name };
  return { type: outcome.kind };
}

function scrubVotes(game, playerId) {
  delete game.votes[playerId];
  for (const [voterId, targetId] of Object.entries(game.votes)) {
    if (targetId === playerId) delete game.votes[voterId];
  }
  if (game.revoteIds) {
    game.revoteIds = game.revoteIds.filter((id) => id !== playerId);
    if (game.revoteIds.length < 2) game.revoteIds = null;
  }
}

export function kill(game, playerId) {
  if (game.phase === "lobby") throw new Error("Игра ещё не началась");
  const player = mustPlayer(game, playerId);
  if (!player.alive) throw new Error("Игрок уже в тюрьме");
  player.alive = false;
  if (game.phase === "voting") scrubVotes(game, playerId);
}

export function resurrect(game, playerId) {
  if (game.phase === "lobby") throw new Error("Игра ещё не началась");
  const player = mustPlayer(game, playerId);
  if (player.alive) throw new Error("Игрок жив");
  player.alive = true;
}

export function snapshot(game) {
  const counts = voteCounts(game);
  const votersByTarget = {};
  for (const [voterId, targetId] of Object.entries(game.votes)) {
    const voter = game.players.find((player) => player.id === voterId);
    if (!voter) continue;
    if (!votersByTarget[targetId]) votersByTarget[targetId] = [];
    votersByTarget[targetId].push({ id: voter.id, name: voter.name });
  }

  const ranked = game.phase === "voting" && allRequiredVoted(game);
  let players = game.players.map((player, index) => ({
    id: player.id,
    name: player.name,
    alive: player.alive,
    claimed: Boolean(player.sessionId),
    avatar: player.avatar || null,
    voteCount: counts.get(player.id) || 0,
    voters: votersByTarget[player.id] || [],
    index,
    dim: false,
    group: "roster",
  }));

  if (ranked) {
    const alive = players.filter((player) => player.alive);
    const dead = players.filter((player) => !player.alive);
    const withVotes = alive
      .filter((player) => player.voteCount > 0)
      .sort((a, b) => b.voteCount - a.voteCount || a.index - b.index);
    const none = alive.filter((player) => player.voteCount === 0);
    for (const player of withVotes) player.group = "ranked";
    for (const player of none) {
      player.dim = true;
      player.group = "none";
    }
    for (const player of dead) {
      player.dim = true;
      player.group = "dead";
    }
    players = [...withVotes, ...none, ...dead];
  }

  const preview = game.phase === "voting" ? describeOutcome(game) : null;

  return {
    id: game.id,
    phase: game.phase,
    ranked,
    canRevote: canRevote(game),
    allVoted: ranked,
    revoteIds: game.revoteIds ? [...game.revoteIds] : [],
    preview,
    players: players.map(({ index, ...player }) => player),
    notVoted:
      game.phase === "voting"
        ? game.players
            .filter((player) => mustVote(game, player) && !game.votes[player.id])
            .map((player) => ({ id: player.id, name: player.name }))
        : [],
    claimedCount: game.players.filter((player) => player.sessionId).length,
    playerCount: game.players.length,
  };
}

export function viewFor(game, viewer) {
  const state = snapshot(game);
  if (viewer.role === "host") {
    return { ...state, isHost: true, you: null, yourVote: null, spectating: false };
  }
  const me = playerBySession(game, viewer.sessionId);
  return {
    ...state,
    isHost: false,
    spectating: isSpectator(game, viewer.sessionId),
    you: me ? { id: me.id, name: me.name, alive: me.alive } : null,
    yourVote: me ? game.votes[me.id] || null : null,
  };
}

export function tokensMatch(expected, actual) {
  if (typeof expected !== "string" || typeof actual !== "string") return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
