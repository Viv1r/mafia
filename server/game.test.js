import assert from "node:assert/strict";
import test from "node:test";
import {
  allRequiredVoted,
  beginRevote,
  beginVote,
  canRevote,
  castVote,
  claim,
  createGame,
  endVote,
  freeSeat,
  kill,
  leaveSpectate,
  release,
  resurrect,
  snapshot,
  setAvatar,
  spectate,
  startGame,
  viewFor,
} from "./game.js";

function names(game) {
  return snapshot(game).players.map((player) => player.name);
}

function seatAll(game) {
  game.players.forEach((player, index) => claim(game, `s${index}`, player.id));
}

test("rejects a short or repeated roster", () => {
  assert.throws(() => createGame(["Аня"]), /минимум два/);
  assert.throws(() => createGame(["Аня", "аня"]), /повторяется/);
  const game = createGame(["  Дима ", "Лена"]);
  assert.deepEqual(
    game.players.map((player) => player.name),
    ["Дима", "Лена"],
  );
});

test("players claim, switch, and free a name only in the lobby", () => {
  const game = createGame(["Дима", "Лена", "Олег"]);
  claim(game, "phone-1", game.players[0].id);
  assert.throws(() => claim(game, "phone-2", game.players[0].id), /занято/);
  release(game, "phone-1");
  claim(game, "phone-2", game.players[0].id);
  freeSeat(game, game.players[0].id);
  assert.equal(game.players[0].sessionId, null);
  assert.throws(() => startGame(game), /не все/);
  seatAll(game);
  startGame(game);
  assert.equal(game.phase, "day");
  assert.throws(() => release(game, "s0"), /уже началась/);
});

test("a clear vote sends that player to prison", () => {
  const game = createGame(["Аня", "Боря", "Вика", "Глеб"]);
  seatAll(game);
  startGame(game);
  beginVote(game);
  const [anya, borya, vika, gleb] = game.players;
  castVote(game, borya.id, anya.id);
  castVote(game, vika.id, anya.id);
  castVote(game, gleb.id, anya.id);
  castVote(game, anya.id, borya.id);
  assert.equal(canRevote(game), false);
  const view = snapshot(game);
  assert.deepEqual(names(game), ["Аня", "Боря", "Вика", "Глеб"]);
  assert.equal(view.players[0].voteCount, 3);
  assert.deepEqual(
    view.players[0].voters.map((voter) => voter.name),
    ["Боря", "Вика", "Глеб"],
  );
  assert.equal(view.players[2].dim, true);
  assert.equal(view.players[2].group, "none");
  const event = endVote(game);
  assert.deepEqual(event, { type: "prison", name: "Аня" });
  assert.equal(anya.alive, false);
  assert.equal(game.phase, "day");
  assert.deepEqual(game.votes, {});
});

test("a tie can be revoted only among the leaders", () => {
  const game = createGame(["Аня", "Боря", "Вика", "Глеб"]);
  seatAll(game);
  startGame(game);
  beginVote(game);
  const [anya, borya, vika, gleb] = game.players;
  castVote(game, vika.id, anya.id);
  castVote(game, gleb.id, borya.id);
  assert.equal(canRevote(game), false);
  castVote(game, anya.id, borya.id);
  castVote(game, borya.id, anya.id);
  assert.equal(canRevote(game), true);
  assert.deepEqual(names(game).slice(0, 2), ["Аня", "Боря"]);
  assert.equal(snapshot(game).players.find((player) => player.name === "Вика").dim, true);

  const event = endVote(game);
  assert.deepEqual(event, { type: "tie" });
  assert.equal(anya.alive, true);
  assert.equal(borya.alive, true);

  beginVote(game);
  castVote(game, anya.id, borya.id);
  castVote(game, borya.id, anya.id);
  castVote(game, vika.id, anya.id);
  castVote(game, gleb.id, borya.id);
  beginRevote(game);
  assert.equal(allRequiredVoted(game), false);
  assert.throws(() => castVote(game, vika.id, gleb.id), /нельзя/);
  castVote(game, anya.id, borya.id);
  castVote(game, borya.id, anya.id);
  castVote(game, vika.id, anya.id);
  castVote(game, gleb.id, anya.id);
  assert.deepEqual(endVote(game), { type: "prison", name: "Аня" });
  assert.equal(anya.alive, false);
});

test("a player can change a vote until the host closes it", () => {
  const game = createGame(["Аня", "Боря", "Вика"]);
  seatAll(game);
  startGame(game);
  beginVote(game);
  const [anya, borya, vika] = game.players;
  castVote(game, anya.id, borya.id);
  castVote(game, anya.id, vika.id);
  assert.equal(game.votes[anya.id], vika.id);
  assert.throws(() => castVote(game, anya.id, anya.id), /нельзя/);
});

test("an avatar stays in memory until the vote starts", () => {
  const game = createGame(["Аня", "Боря"]);
  const picture = "data:image/jpeg;base64,aaaa";
  setAvatar(game, game.players[0].id, picture);
  assert.equal(snapshot(game).players[0].avatar, picture);
  seatAll(game);
  startGame(game);
  beginVote(game);
  assert.throws(() => setAvatar(game, game.players[0].id, picture), /нельзя сменить фото/);
});

test("the dead cannot vote and leave the tally", () => {
  const game = createGame(["Аня", "Боря", "Вика", "Глеб"]);
  seatAll(game);
  startGame(game);
  beginVote(game);
  const [anya, borya, vika, gleb] = game.players;
  castVote(game, borya.id, anya.id);
  castVote(game, anya.id, borya.id);
  kill(game, anya.id);
  assert.equal(anya.alive, false);
  assert.equal(game.votes[anya.id], undefined);
  assert.equal(game.votes[borya.id], undefined);
  assert.throws(() => castVote(game, anya.id, borya.id), /не может/);
  castVote(game, borya.id, vika.id);
  castVote(game, vika.id, gleb.id);
  castVote(game, gleb.id, vika.id);
  assert.equal(snapshot(game).notVoted.some((player) => player.name === "Аня"), false);
  resurrect(game, anya.id);
  assert.equal(anya.alive, true);
  assert.deepEqual(snapshot(game).notVoted.map((player) => player.name), ["Аня"]);
});

test("a spectator takes no seat and can still pick a name before the start", () => {
  const game = createGame(["Аня", "Боря"]);
  spectate(game, "watcher-1");
  assert.equal(viewFor(game, { role: "player", sessionId: "watcher-1" }).spectating, true);
  assert.equal(game.players.every((player) => !player.sessionId), true);
  assert.throws(() => claim(game, "watcher-1", game.players[0].id), /наблюден/);
  leaveSpectate(game, "watcher-1");
  claim(game, "watcher-1", game.players[0].id);
  assert.equal(game.players[0].sessionId, "watcher-1");
  spectate(game, "watcher-2");
  claim(game, "s1", game.players[1].id);
  startGame(game);
  assert.equal(viewFor(game, { role: "player", sessionId: "watcher-2" }).spectating, true);
  assert.equal(viewFor(game, { role: "player", sessionId: "watcher-2" }).you, null);
  assert.throws(() => leaveSpectate(game, "watcher-2"), /уже началась/);
});

test("ending with no votes imprisons nobody", () => {
  const game = createGame(["Аня", "Боря"]);
  seatAll(game);
  startGame(game);
  beginVote(game);
  assert.deepEqual(endVote(game), { type: "empty" });
  assert.equal(game.players.every((player) => player.alive), true);
});
