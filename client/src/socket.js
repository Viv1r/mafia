import { useEffect, useRef, useState } from "react";

export function getSessionId() {
  const key = "mafia:sid";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export function useMafiaSocket({ enabled, join }) {
  const [state, setState] = useState(null);
  const [event, setEvent] = useState(null);
  const [error, setError] = useState(null);
  const [online, setOnline] = useState(false);
  const wsRef = useRef(null);
  const joinKey = JSON.stringify(join);

  useEffect(() => {
    if (!error) return undefined;
    const timer = window.setTimeout(() => setError(null), 3800);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let timer = 0;
    let attempt = 0;
    let socket;

    const connect = () => {
      socket = new WebSocket(wsUrl());
      wsRef.current = socket;
      socket.onopen = () => {
        if (stopped) return;
        attempt = 0;
        setOnline(true);
        socket.send(joinKey);
      };
      socket.onmessage = (message) => {
        if (stopped) return;
        let data;
        try {
          data = JSON.parse(message.data);
        } catch {
          return;
        }
        if (data.type === "state") setState(data.state);
        if (data.type === "avatar") {
          setState((current) => {
            if (!current) return current;
            return {
              ...current,
              players: current.players.map((player) =>
                player.id === data.playerId ? { ...player, avatar: data.avatar } : player,
              ),
            };
          });
        }
        if (data.type === "event") setEvent(data.event);
        if (data.type === "error") setError(data.message);
      };
      socket.onclose = () => {
        if (wsRef.current === socket) setOnline(false);
        if (stopped) return;
        const delay = Math.min(4000, 300 * 2 ** attempt);
        attempt += 1;
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, [enabled, joinKey]);

  function send(payload) {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Нет связи с сервером");
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  return { state, event, setEvent, error, setError, online, send };
}
