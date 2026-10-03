import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { getSessionId, useMafiaSocket } from "./socket.js";

function routeOf(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  const host = path.match(/^\/host\/([A-Za-z0-9]+)$/);
  if (host) return { name: "host", gameId: host[1] };
  const play = path.match(/^\/g\/([A-Za-z0-9]+)$/);
  if (play) return { name: "play", gameId: play[1] };
  return { name: "create", gameId: null };
}

function resultText(event) {
  if (event.type === "prison") return `${event.name} отправляется в тюрьму`;
  if (event.type === "tie") return "Ничья. Ведущий решает";
  return "Никто не отправляется в тюрьму";
}

function previewText(preview) {
  if (!preview || preview.kind === "empty") return "Если завершить сейчас, в тюрьму никто не отправится.";
  if (preview.kind === "tie") return "Если завершить сейчас, будет ничья и в тюрьму никто не отправится.";
  return `Если завершить сейчас, ${preview.name} отправится в тюрьму.`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function Shell({ online, error, event, onCloseEvent, children }) {
  return (
    <main className="screen">
      {online === false && <p className="offline">Нет связи, переподключение…</p>}
      {children}
      {event && (
        <div className="modal-back" role="dialog" aria-modal="true" data-testid="result-modal">
          <div className="modal">
            <p className="kicker">Итог голосования</p>
            <h2>{resultText(event)}</h2>
            <button className="btn primary" type="button" onClick={onCloseEvent}>
              Понятно
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="toast" role="status">
          {error}
        </div>
      )}
    </main>
  );
}

function Avatar({ src }) {
  if (src) return <img className="avatar" src={src} alt="" />;
  return (
    <span className="avatar avatar-placeholder" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20">
        <circle cx="12" cy="8" r="3.2" fill="currentColor" />
        <path d="M5.4 19.2a6.6 6.6 0 0 1 13.2 0" fill="currentColor" />
      </svg>
    </span>
  );
}

function compressAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Нужна картинка"));
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const size = 96;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать картинку"));
    };
    image.src = url;
  });
}

function AvatarPicker({ avatar, onFile }) {
  return (
    <label className="avatar-picker">
      <Avatar src={avatar} />
      <span>{avatar ? "Сменить фото" : "Загрузить фото"}</span>
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function PeopleList({ players, ranked, yourVote, leaderId, onMenu, onVote, voteTargetIds = [] }) {
  const row = (player) => {
    const faded = player.dim || !player.alive;
    const clickable = Boolean(onVote && voteTargetIds.includes(player.id));
    const className = [
      "person",
      faded ? "is-faded" : "",
      yourVote === player.id ? "is-yours" : "",
      leaderId === player.id ? "is-leader" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const inner = (
      <>
        <Avatar src={player.avatar} />
        <div className="person-main">
          <span className="person-name">{player.name}</span>
          {!player.alive && <span className="tag">выбыл(а)</span>}
          {yourVote === player.id && <span className="tag">ваш голос</span>}
          {player.voteCount > 0 && <span className="count">{player.voteCount}</span>}
          {player.voters.map((voter) => (
            <span className="badge" key={voter.id}>
              {voter.name}
            </span>
          ))}
        </div>
        {onMenu && (
          <button className="icon-btn" type="button" aria-label={`Действия: ${player.name}`} onClick={() => onMenu(player)}>
            ···
          </button>
        )}
      </>
    );
    if (!clickable) {
      return (
        <div className={className} key={player.id}>
          {inner}
        </div>
      );
    }
    return (
      <button
        className={className}
        key={player.id}
        type="button"
        onClick={() => {
          if (player.id !== yourVote) onVote(player.id);
        }}
      >
        {inner}
      </button>
    );
  };

  const living = players.filter((player) => player.alive);
  const dead = players.filter((player) => !player.alive);
  const rankedRows = ranked ? living.filter((player) => player.group === "ranked") : living;
  const none = ranked ? living.filter((player) => player.group === "none") : [];

  return (
    <div className="people">
      {rankedRows.map(row)}
      {none.length > 0 && <h3 className="group-label">Без голосов</h3>}
      {none.map(row)}
      {dead.length > 0 && <h3 className="group-label">Выбывшие игроки</h3>}
      {dead.map(row)}
    </div>
  );
}

function ActionSheet({ player, state, onClose, send }) {
  const [picking, setPicking] = useState(false);
  if (!player) return null;
  const targets = state.players.filter(
    (item) => item.alive && item.id !== player.id && (state.revoteIds.length === 0 || state.revoteIds.includes(item.id)),
  );

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2>{player.name}</h2>
        {!picking && (
          <div className="sheet-actions">
            {player.alive ? (
              <button
                className="btn danger"
                type="button"
                onClick={() => {
                  send({ type: "kill", playerId: player.id });
                  onClose();
                }}
              >
                Убить
              </button>
            ) : (
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  send({ type: "resurrect", playerId: player.id });
                  onClose();
                }}
              >
                Воскресить
              </button>
            )}
            {state.phase === "voting" && player.alive && (
              <button className="btn ghost" type="button" onClick={() => setPicking(true)}>
                Голос от лица игрока
              </button>
            )}
            <button className="btn ghost" type="button" onClick={onClose}>
              Закрыть
            </button>
          </div>
        )}
        {picking && (
          <div className="stack">
            <p className="sub">Куда отдать голос. Себя выбрать нельзя.</p>
            <div className="vote-grid">
              {targets.map((target) => (
                <button
                  key={target.id}
                  className="vote-btn"
                  type="button"
                  onClick={() => {
                    send({ type: "voteAs", playerId: player.id, targetId: target.id });
                    onClose();
                  }}
                >
                  {target.name}
                </button>
              ))}
            </div>
            {targets.length === 0 && <p className="sub">Сейчас нет доступных целей.</p>}
            <button className="btn ghost" type="button" onClick={() => setPicking(false)}>
              Назад
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateGame() {
  const [draft, setDraft] = useState("");
  const [names, setNames] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function addNames(raw) {
    const parts = String(raw)
      .split(/[\n,]/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setNames((current) => {
      const next = [...current];
      for (const name of parts) {
        const key = name.toLocaleLowerCase("ru");
        if (next.some((item) => item.toLocaleLowerCase("ru") === key)) continue;
        next.push(name);
      }
      return next.slice(0, 24);
    });
    setDraft("");
    setError("");
  }

  async function createGame() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Не удалось создать игру");
      localStorage.setItem(`mafia:host:${data.id}`, data.hostToken);
      location.assign(`/host/${data.id}?t=${encodeURIComponent(data.hostToken)}`);
    } catch (reason) {
      setError(reason.message || "Не удалось создать игру");
      setBusy(false);
    }
  }

  return (
    <Shell online={null} error={error} event={null} onCloseEvent={() => {}}>
      <header className="header">
        <p className="kicker">Ведущий</p>
        <h1>Новая игра</h1>
        <p className="sub">Добавьте имена. Роли раздавать не нужно: игроки только выбирают себя по ссылке.</p>
      </header>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          addNames(draft);
        }}
      >
        <div className="add-row">
          <input
            value={draft}
            placeholder="Имя игрока"
            autoComplete="off"
            autoCapitalize="words"
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              if (!/[\n,]/.test(text)) return;
              event.preventDefault();
              addNames(text);
            }}
          />
          <button className="btn ghost" type="submit" style={{ width: "auto", padding: "0 16px" }}>
            Добавить
          </button>
        </div>
        <div className="chip-list stack">
          {names.map((name) => (
            <div className="chip" key={name}>
              <span>{name}</span>
              <button className="text-btn" type="button" onClick={() => setNames(names.filter((item) => item !== name))}>
                Убрать
              </button>
            </div>
          ))}
        </div>
        <button className="btn primary" type="button" data-testid="create-game" disabled={busy || names.length < 2} onClick={createGame}>
          Создать игру
        </button>
        {names.length < 2 && <p className="sub">Минимум два имени.</p>}
      </form>
    </Shell>
  );
}

function QrModal({ url, onClose }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      margin: 1,
      width: 640,
      errorCorrectionLevel: "M",
      color: { dark: "#1a1a1a", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="QR для входа в игру" data-testid="qr-modal">
      <div className="modal qr-modal">
        <p className="kicker">Вход в игру</p>
        <h2>QR для игроков</h2>
        {src ? <img className="qr-image" src={src} alt="QR-код для входа в игру" /> : <p className="sub">Код готовится…</p>}
        <p className="link-card">{url}</p>
        <button className="btn primary" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

function PlayerLink({ gameId, compact = false }) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const url = `${location.origin}/g/${gameId}`;
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  async function copyLink() {
    await copyText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const qr = qrOpen ? <QrModal url={url} onClose={() => setQrOpen(false)} /> : null;

  if (compact) {
    return (
      <>
        <div className="stack">
          <button className="btn ghost" type="button" onClick={copyLink}>
            {copied ? "Ссылка скопирована" : "Скопировать ссылку для игроков"}
          </button>
          <button className="btn ghost" type="button" data-testid="show-qr" onClick={() => setQrOpen(true)}>
            Показать QR
          </button>
        </div>
        {qr}
      </>
    );
  }

  return (
    <section className="panel">
      <strong>Ссылка для игроков</strong>
      <p className="link-card" data-testid="player-link">
        {url}
      </p>
      <div className="stack" style={{ marginTop: 10 }}>
        <button className="btn ghost" type="button" onClick={copyLink}>
          {copied ? "Скопировано" : "Скопировать"}
        </button>
        <button className="btn ghost" type="button" data-testid="show-qr" onClick={() => setQrOpen(true)}>
          Показать QR
        </button>
      </div>
      {local && (
        <p className="sub" style={{ marginTop: 10 }}>
          Телефоны не откроют localhost. Зайдите на этот сайт по IP компьютера в Wi‑Fi: Vite пишет его в терминале как Network.
        </p>
      )}
      {qr}
    </section>
  );
}

function HostGame({ gameId }) {
  const [token] = useState(() => {
    const fromQuery = new URLSearchParams(location.search).get("t");
    if (fromQuery) {
      localStorage.setItem(`mafia:host:${gameId}`, fromQuery);
      return fromQuery;
    }
    return localStorage.getItem(`mafia:host:${gameId}`);
  });
  const [menu, setMenu] = useState(null);
  const join = useMemo(() => ({ type: "join", role: "host", gameId, hostToken: token }), [gameId, token]);
  const socket = useMafiaSocket({ enabled: Boolean(token), join });
  const { state, send } = socket;

  if (!token) {
    return (
      <Shell online={null} error="" event={null} onCloseEvent={() => {}}>
        <header className="header">
          <p className="kicker">Ведущий</p>
          <h1>Нужна ваша ссылка</h1>
          <p className="sub">Откройте адрес, который браузер сохранил после создания игры. Ссылка для игроков права ведущего не даёт.</p>
        </header>
      </Shell>
    );
  }

  const leaderId = state?.ranked && state.preview?.kind === "prison" ? state.players.find((player) => player.group === "ranked")?.id : null;
  const alive = state?.players.filter((player) => player.alive).length ?? 0;
  const revoteNames = state?.players.filter((player) => state.revoteIds.includes(player.id)).map((player) => player.name) ?? [];

  return (
    <Shell online={socket.online} error={socket.error} event={socket.event} onCloseEvent={() => socket.setEvent(null)}>
      {!state && (
        <header className="header">
          <p className="kicker">Ведущий</p>
          <h1>{socket.online ? "Загрузка…" : "Подключение…"}</h1>
        </header>
      )}
      {state && (
        <>
          <header className="header">
            <p className="kicker">Ведущий</p>
            <h1>{state.phase === "lobby" ? "Комната" : state.phase === "voting" ? (revoteNames.length ? "Переголосование" : "Голосование") : "Игра"}</h1>
            {state.phase === "lobby" && (
              <p className="sub">
                Имена выбрали {state.claimedCount} из {state.playerCount}. Пока вы не нажали «Начать игру», игрок может сменить имя.
              </p>
            )}
            {state.phase === "day" && <p className="sub">Кнопка справа убивает, воскрешает или голосует от имени игрока.</p>}
            {state.phase === "voting" && revoteNames.length > 0 && <p className="sub">Голосовать можно только за: {revoteNames.join(", ")}</p>}
          </header>
          <PlayerLink gameId={gameId} compact={state.phase !== "lobby"} />
          {state.phase === "voting" && (
            <section className="panel" data-testid="not-voted">
              <strong>Не голосовали</strong>
              {state.notVoted.length === 0 ? (
                <p className="done" style={{ marginTop: 8 }}>
                  Все проголосовали
                </p>
              ) : (
                <ul>
                  {state.notVoted.map((player) => (
                    <li key={player.id}>{player.name}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {state.phase === "lobby" ? (
            <div className="people">
              {state.players.map((player) => (
                <div className="person" key={player.id}>
                  <Avatar src={player.avatar} />
                  <div className="person-main">
                    <span className="person-name" style={{ opacity: player.claimed ? 0.5 : 1 }}>
                      {player.name}
                    </span>
                    <span className="tag">{player.claimed ? "занято" : "свободно"}</span>
                  </div>
                  {player.claimed && (
                    <button className="text-btn" type="button" onClick={() => send({ type: "freeSeat", playerId: player.id })}>
                      Освободить
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <PeopleList players={state.players} ranked={state.ranked} leaderId={leaderId} onMenu={setMenu} />
          )}
          <div className="actions">
            {state.phase === "lobby" && (
              <button
                className="btn primary"
                type="button"
                data-testid="start-game"
                disabled={state.claimedCount !== state.playerCount}
                onClick={() => send({ type: "start" })}
              >
                Начать игру
              </button>
            )}
            {state.phase === "day" && (
              <button className="btn primary" type="button" data-testid="begin-vote" disabled={alive < 2} onClick={() => send({ type: "beginVote" })}>
                Начать голосование
              </button>
            )}
            {state.phase === "voting" && (
              <>
                <p className="sub">{previewText(state.preview)}</p>
                {state.canRevote && (
                  <button className="btn primary" type="button" data-testid="revote" onClick={() => send({ type: "revote" })}>
                    Переголосование
                  </button>
                )}
                <button
                  className={state.canRevote ? "btn ghost" : "btn primary"}
                  type="button"
                  data-testid="end-vote"
                  onClick={() => send({ type: "endVote" })}
                >
                  Завершить голосование
                </button>
              </>
            )}
          </div>
          <ActionSheet key={menu?.id ?? "closed"} player={menu} state={state} onClose={() => setMenu(null)} send={send} />
        </>
      )}
    </Shell>
  );
}

function PlayerGame({ gameId }) {
  const [sessionId] = useState(getSessionId);
  const join = useMemo(() => ({ type: "join", role: "player", gameId, sessionId }), [gameId, sessionId]);
  const socket = useMafiaSocket({ enabled: true, join });
  const { state, send } = socket;

  const targets =
    state?.you && state.phase === "voting"
      ? state.players.filter(
          (player) => player.alive && player.id !== state.you.id && (state.revoteIds.length === 0 || state.revoteIds.includes(player.id)),
        )
      : [];
  const revoteNames = state?.players.filter((player) => state.revoteIds.includes(player.id)).map((player) => player.name) ?? [];
  const ownAvatar = state?.you ? state.players.find((player) => player.id === state.you.id)?.avatar : null;

  async function chooseAvatar(file) {
    try {
      send({ type: "avatar", avatar: await compressAvatar(file) });
    } catch (error) {
      socket.setError(error.message || "Не удалось загрузить фото");
    }
  }

  let body = null;
  if (!state) {
    body = (
      <header className="header">
        <p className="kicker">Игрок</p>
        <h1>{socket.online ? "Загрузка…" : "Подключение…"}</h1>
      </header>
    );
  } else if (state.spectating) {
    body = (
      <>
        <header className="header">
          <p className="kicker">Наблюдатель</p>
          <h1>Игроки</h1>
          <p className="sub">
            {state.phase === "lobby"
              ? "Вы наблюдаете. Имя можно выбрать, пока ведущий не начал игру."
              : "Вы наблюдаете и не голосуете."}
          </p>
        </header>
        {state.phase === "lobby" && (
          <button className="btn ghost" type="button" data-testid="leave-spectate" onClick={() => send({ type: "leaveSpectate" })}>
            Выбрать имя
          </button>
        )}
        <div style={{ height: state.phase === "lobby" ? 10 : 0 }} />
        <PeopleList players={state.players} ranked={state.ranked} yourVote={null} />
      </>
    );
  } else if (state.phase === "lobby" && !state.you) {
    body = (
      <>
        <header className="header">
          <p className="kicker">Игрок</p>
          <h1>Выберите имя</h1>
          <p className="sub">Занятые имена тусклые, их взять нельзя. Можно просто смотреть игру.</p>
        </header>
        <div className="name-grid">
          {state.players.map((player) => (
            <button
              key={player.id}
              type="button"
              className={player.claimed ? "name-btn taken" : "name-btn"}
              disabled={player.claimed}
              onClick={() => send({ type: "claim", playerId: player.id })}
            >
              <Avatar src={player.avatar} />
              {player.name}
            </button>
          ))}
        </div>
        <button className="btn ghost" type="button" data-testid="spectate" style={{ marginTop: 10 }} onClick={() => send({ type: "spectate" })}>
          Наблюдать
        </button>
      </>
    );
  } else if (state.phase === "lobby" && state.you) {
    body = (
      <>
        <header className="header">
          <p className="kicker">Игрок</p>
          <h1>{state.you.name}</h1>
          <p className="sub">Это вы. Имя можно сменить, пока ведущий не начал игру.</p>
        </header>
        <AvatarPicker avatar={ownAvatar} onFile={chooseAvatar} />
        <button className="btn ghost" type="button" data-testid="release-name" onClick={() => send({ type: "release" })}>
          Сменить имя
        </button>
        <div className="name-grid" style={{ marginTop: 10 }}>
          {state.players.map((player) => (
            <button key={player.id} type="button" className={player.claimed ? "name-btn taken" : "name-btn"} disabled>
              <Avatar src={player.avatar} />
              {player.name}
            </button>
          ))}
        </div>
      </>
    );
  } else if (!state.you) {
    body = (
      <>
        <header className="header">
          <p className="kicker">Игрок</p>
          <h1>Мест нет</h1>
          <p className="sub">Игра уже началась, а это устройство в неё не входило. Можно смотреть список игроков.</p>
        </header>
        <button className="btn ghost" type="button" data-testid="spectate" onClick={() => send({ type: "spectate" })}>
          Наблюдать
        </button>
      </>
    );
  } else if (!state.you.alive) {
    body = (
      <>
        <header className="header">
          <p className="kicker">{state.you.name}</p>
          <h1>Игроки</h1>
          <p className="sub">Вы в тюрьме и не голосуете.</p>
        </header>
        <PeopleList players={state.players} ranked={state.ranked} yourVote={null} />
      </>
    );
  } else if (state.phase === "voting") {
    const voteHint = state.yourVote
      ? "Нажмите другого игрока, чтобы сменить голос."
      : revoteNames.length
        ? `Можно голосовать только за: ${revoteNames.join(", ")}`
        : "Нажмите игрока. Чужие голоса появляются на кнопке сразу.";
    body = (
      <>
        <header className="header">
          <p className="kicker">{state.you.name}</p>
          <h1>{revoteNames.length ? "Переголосование" : "Голосование"}</h1>
          <p className="sub">{voteHint}</p>
        </header>
        {state.ranked ? (
          <PeopleList
            players={state.players}
            ranked
            yourVote={state.yourVote}
            voteTargetIds={targets.map((player) => player.id)}
            onVote={(targetId) => send({ type: "vote", targetId })}
          />
        ) : (
          <div className="vote-grid" data-testid="vote-grid">
            {targets.map((player) => (
              <button
                key={player.id}
                className={state.yourVote === player.id ? "vote-btn is-selected" : "vote-btn"}
                type="button"
                onClick={() => {
                  if (player.id !== state.yourVote) send({ type: "vote", targetId: player.id });
                }}
              >
                <span className="vote-btn-line">
                  <Avatar src={player.avatar} />
                  <span>{player.name}</span>
                </span>
                {player.voters.length > 0 && (
                  <span className="badges">
                    {player.voteCount > 0 && <span className="count">{player.voteCount}</span>}
                    {player.voters.map((voter) => (
                      <span className="badge" key={voter.id}>
                        {voter.name}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        <header className="header">
          <p className="kicker">{state.you.name}</p>
          <h1>Игроки</h1>
          <p className="sub">Ведущий ещё не открыл голосование.</p>
        </header>
        {state.you.alive && <AvatarPicker avatar={ownAvatar} onFile={chooseAvatar} />}
        <PeopleList players={state.players} ranked={false} yourVote={null} />
      </>
    );
  }

  return (
    <Shell online={socket.online} error={socket.error} event={socket.event} onCloseEvent={() => socket.setEvent(null)}>
      {body}
    </Shell>
  );
}

export default function App() {
  const route = routeOf(location.pathname);
  if (route.name === "host") return <HostGame gameId={route.gameId} />;
  if (route.name === "play") return <PlayerGame gameId={route.gameId} />;
  return <CreateGame />;
}
