import path from "node:path";
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import {
  beginRevote,
  beginVote,
  castVote,
  claim,
  createGame,
  createId,
  endVote,
  freeSeat,
  kill,
  playerBySession,
  leaveSpectate,
  release,
  resurrect,
  setAvatar,
  spectate,
  startGame,
  tokensMatch,
  viewFor,
} from "./game.js";

const games = new Map();
const rooms = new Map();

function roomOf(gameId) {
  if (!rooms.has(gameId)) rooms.set(gameId, new Set());
  return rooms.get(gameId);
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(game, event = null) {
  const room = rooms.get(game.id);
  if (!room) return;
  for (const ws of room) {
    if (ws.readyState !== ws.OPEN) continue;
    send(ws, {
      type: "state",
      state: viewFor(game, { role: ws.role, sessionId: ws.sessionId }),
    });
  }
  if (!event) return;
  for (const ws of room) send(ws, { type: "event", event });
}

function act(ws, fn) {
  const game = games.get(ws.gameId);
  if (!game) {
    send(ws, { type: "error", message: "Игра не найдена" });
    return;
  }
  if (ws.role === "host" && !ws.hostOk) {
    send(ws, { type: "error", message: "Нет прав ведущего" });
    return;
  }
  try {
    const event = fn(game) ?? null;
    broadcast(game, event);
  } catch (error) {
    send(ws, { type: "error", message: error.message || "Ошибка" });
  }
}

function requirePlayer(game, ws) {
  const player = playerBySession(game, ws.sessionId);
  if (!player) throw new Error("Сначала выберите имя");
  return player;
}

export function attachApp(app) {
  app.use(express.json({ limit: "32kb" }));

  app.post("/api/games", (req, res) => {
    try {
      const game = createGame(req.body?.names);
      let guard = 0;
      while (games.has(game.id) && guard < 5) {
        game.id = createId();
        guard += 1;
      }
      games.set(game.id, game);
      res.status(201).json({ id: game.id, hostToken: game.hostToken });
    } catch (error) {
      res.status(400).json({ message: error.message || "Не удалось создать игру" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
}

export function attachSockets(server) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1_000_000 });

  wss.on("connection", (ws) => {
    ws.role = null;
    ws.gameId = null;
    ws.sessionId = null;
    ws.hostOk = false;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        send(ws, { type: "error", message: "Некорректное сообщение" });
        return;
      }
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "join") {
        const game = games.get(msg.gameId);
        if (!game) {
          send(ws, { type: "error", message: "Игра не найдена" });
          return;
        }
        if (ws.gameId && rooms.get(ws.gameId)) rooms.get(ws.gameId).delete(ws);
        if (msg.role === "host") {
          if (!tokensMatch(game.hostToken, msg.hostToken)) {
            send(ws, { type: "error", message: "Ссылка ведущего недействительна" });
            return;
          }
          ws.role = "host";
          ws.hostOk = true;
          ws.sessionId = null;
        } else {
          if (typeof msg.sessionId !== "string" || msg.sessionId.length < 8 || msg.sessionId.length > 80) {
            send(ws, { type: "error", message: "Нет сессии игрока" });
            return;
          }
          ws.role = "player";
          ws.hostOk = false;
          ws.sessionId = msg.sessionId;
        }
        ws.gameId = game.id;
        roomOf(game.id).add(ws);
        send(ws, { type: "state", state: viewFor(game, ws) });
        return;
      }

      if (!ws.gameId) {
        send(ws, { type: "error", message: "Сначала подключитесь к игре" });
        return;
      }

      if (msg.type === "spectate") {
        act(ws, (game) => {
          if (ws.role !== "player") throw new Error("Наблюдать может игрок");
          spectate(game, ws.sessionId);
        });
        return;
      }
      if (msg.type === "leaveSpectate") {
        act(ws, (game) => {
          if (ws.role !== "player") throw new Error("Это действие игрока");
          leaveSpectate(game, ws.sessionId);
        });
        return;
      }
      if (msg.type === "claim") {
        act(ws, (game) => {
          if (ws.role !== "player") throw new Error("Имя выбирает игрок");
          claim(game, ws.sessionId, msg.playerId);
        });
        return;
      }
      if (msg.type === "release") {
        act(ws, (game) => {
          if (ws.role !== "player") throw new Error("Имя меняет игрок");
          release(game, ws.sessionId);
        });
        return;
      }
      if (msg.type === "freeSeat") {
        act(ws, (game) => {
          if (ws.role !== "host") throw new Error("Это действие ведущего");
          freeSeat(game, msg.playerId);
        });
        return;
      }
      if (msg.type === "start") {
        act(ws, (game) => {
          if (ws.role !== "host") throw new Error("Это действие ведущего");
          startGame(game);
        });
        return;
      }
      if (msg.type === "beginVote") {
        act(ws, (game) => {
          if (ws.role !== "host") throw new Error("Это действие ведущего");
          beginVote(game);
        });
        return;
      }
      if (msg.type === "endVote") {
        act(ws, (game) => {
          if (ws.role !== "host") throw new Error("Это действие ведущего");
          return endVote(game);
        });
        return;
      }
      if (msg.type === "revote") {
        act(ws, (game) => {
          if (ws.role !== "host") throw new Error("Это действие ведущего");
          beginRevote(game);
        });
        return;
      }
      if (msg.type === "vote") {
        act(ws, (game) => {
          if (ws.role !== "player") throw new Error("Так голосует только игрок");
          castVote(game, requirePlayer(game, ws).id, msg.targetId);
        });
        return;
      }
      if (msg.type === "avatar") {
        const game = games.get(ws.gameId);
        if (!game) {
          send(ws, { type: "error", message: "Игра не найдена" });
          return;
        }
        if (ws.role !== "player") {
          send(ws, { type: "error", message: "Аватар ставит игрок" });
          return;
        }
        try {
          const me = requirePlayer(game, ws);
          setAvatar(game, me.id, msg.avatar);
          const note = { type: "avatar", playerId: me.id, avatar: me.avatar };
          const room = rooms.get(game.id);
          if (room) {
            for (const client of room) send(client, note);
          }
          broadcast(game);
        } catch (error) {
          send(ws, { type: "error", message: error.message || "Ошибка" });
        }
        return;
      }
      if (msg.type === "voteAs") {
        act(ws, (game) => {
          if (ws.role !== "host") throw new Error("Это действие ведущего");
          castVote(game, msg.playerId, msg.targetId);
        });
        return;
      }
      if (msg.type === "kill") {
        act(ws, (game) => {
          if (ws.role !== "host") throw new Error("Это действие ведущего");
          kill(game, msg.playerId);
        });
        return;
      }
      if (msg.type === "resurrect") {
        act(ws, (game) => {
          if (ws.role !== "host") throw new Error("Это действие ведущего");
          resurrect(game, msg.playerId);
        });
        return;
      }
    });

    ws.on("close", () => {
      if (ws.gameId && rooms.get(ws.gameId)) rooms.get(ws.gameId).delete(ws);
    });
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, 25000);
  server.on("close", () => clearInterval(ping));

  return wss;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
const isDirectRun = entry && path.normalize(entry).toLowerCase() === path.normalize(self).toLowerCase();

if (isDirectRun) {
  const app = express();
  attachApp(app);
  const dist = path.resolve(path.dirname(self), "../client/dist");
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
      res.sendFile(path.join(dist, "index.html"));
    });
  }
  const server = http.createServer(app);
  attachSockets(server);
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "0.0.0.0", () => {
    console.log(`Mafia server http://localhost:${port}`);
  });
}
