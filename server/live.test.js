import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { WebSocket } from "ws";
import { attachApp, attachSockets } from "./index.js";

function waitFor(read, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      try {
        const value = read();
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (Date.now() - started > 3000) {
          clearInterval(timer);
          reject(new Error(`timeout: ${label}`));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 20);
  });
}

const clients = [];

function openSocket(port, join) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  clients.push(ws);
  const states = [];
  const events = [];
  const errors = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "state") states.push(message.state);
    if (message.type === "event") events.push(message.event);
    if (message.type === "error") errors.push(message.message);
  });
  return new Promise((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify(join));
      resolve({
        ws,
        states,
        events,
        errors,
        send(payload) {
          ws.send(JSON.stringify(payload));
        },
      });
    });
    ws.on("error", reject);
  });
}

test("players rejoin, vote, and the host sends the leader to prison", async () => {
  const app = express();
  attachApp(app);
  const server = http.createServer(app);
  attachSockets(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const created = await fetch(`http://127.0.0.1:${port}/api/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: ["Дима", "Лена", "Олег", "Кира"] }),
    });
    assert.equal(created.status, 201);
    const { id, hostToken } = await created.json();

    const host = await openSocket(port, { type: "join", role: "host", gameId: id, hostToken });
    const dima = await openSocket(port, { type: "join", role: "player", gameId: id, sessionId: "phone-dima" });
    const lena = await openSocket(port, { type: "join", role: "player", gameId: id, sessionId: "phone-lena" });

    const lobby = await waitFor(() => dima.states.at(-1), "lobby");
    const byName = Object.fromEntries(lobby.players.map((player) => [player.name, player.id]));
    dima.send({ type: "claim", playerId: byName["Дима"] });
    lena.send({ type: "claim", playerId: byName["Лена"] });
    dima.send({ type: "release" });
    dima.send({ type: "claim", playerId: byName["Дима"] });

    const sockets = { Олег: "phone-oleg", Кира: "phone-kira" };
    for (const [name, sessionId] of Object.entries(sockets)) {
      const seat = await openSocket(port, { type: "join", role: "player", gameId: id, sessionId });
      const state = await waitFor(() => seat.states.at(-1), name);
      seat.send({ type: "claim", playerId: state.players.find((player) => player.name === name).id });
    }

    await waitFor(() => host.states.at(-1)?.claimedCount === 4, "all claimed");
    host.send({ type: "start" });
    await waitFor(() => host.states.at(-1)?.phase === "day", "day");
    host.send({ type: "beginVote" });
    await waitFor(() => dima.states.at(-1)?.phase === "voting", "voting");

    const voting = dima.states.at(-1);
    const ids = Object.fromEntries(voting.players.map((player) => [player.name, player.id]));
    dima.send({ type: "vote", targetId: ids["Лена"] });
    lena.send({ type: "vote", targetId: ids["Дима"] });
    host.send({ type: "voteAs", playerId: ids["Олег"], targetId: ids["Дима"] });
    host.send({ type: "voteAs", playerId: ids["Кира"], targetId: ids["Дима"] });

    const tallied = await waitFor(() => {
      const state = host.states.at(-1);
      return state?.allVoted ? state : null;
    }, "all voted");
    assert.equal(tallied.notVoted.length, 0);
    assert.equal(tallied.players[0].name, "Дима");
    assert.equal(tallied.players[0].voteCount, 3);
    assert.deepEqual(
      tallied.players[0].voters.map((voter) => voter.name),
      ["Лена", "Олег", "Кира"],
    );
    assert.equal(tallied.players.find((player) => player.name === "Олег").dim, true);
    assert.equal(tallied.preview.kind, "prison");

    host.send({ type: "voteAs", playerId: ids["Кира"], targetId: ids["Лена"] });
    await waitFor(() => {
      const state = host.states.at(-1);
      const lena = state?.players.find((player) => player.name === "Лена");
      return lena?.voteCount === 2 ? state : null;
    }, "changed vote");
    host.send({ type: "voteAs", playerId: ids["Кира"], targetId: ids["Дима"] });
    await waitFor(() => {
      const state = host.states.at(-1);
      const dima = state?.players.find((player) => player.name === "Дима");
      return state?.allVoted && dima?.voteCount === 3 ? state : null;
    }, "revoted");

    host.send({ type: "endVote" });
    const event = await waitFor(() => host.events.at(-1), "event");
    assert.deepEqual(event, { type: "prison", name: "Дима" });
    const after = await waitFor(() => {
      const state = lena.states.at(-1);
      return state?.phase === "day" ? state : null;
    }, "back to day");
    assert.equal(after.players.find((player) => player.name === "Дима").alive, false);

    const returned = await openSocket(port, { type: "join", role: "player", gameId: id, sessionId: "phone-dima" });
    const restored = await waitFor(() => returned.states.find((item) => item.you?.name === "Дима"), "rejoin");
    assert.equal(restored.you.alive, false);

    host.send({ type: "resurrect", playerId: ids["Дима"] });
    await waitFor(() => host.states.at(-1)?.players.find((player) => player.name === "Дима")?.alive, "resurrect");
  } finally {
    for (const ws of clients) ws.close();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
