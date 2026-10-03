## Описание
Простой веб-интерфейс для упрощения голосования в карточной мафии.
Роли здесь НЕ раздаются, система рассчитана на мафию, которая проходит офлайн с физическими карточками. Всё, что делает мой UI - это упрощает голосование днём. Все остальные действия выполняются офлайн. В играх, в которых участвует много людей, это будет полезно.
Если нужна раздача ролей помимо этого функционала, буду рад публичным форкам. Посмотрим, что из этого выйдет.

## Процесс игры
У ведущего и у каждого игрока должно быть мобильное устройство (или любое другое, главное чтобы с браузером).
Хост (ведущий) создаёт на своём устройстве игру, где добавляет список игроков. Далее каждый присоединяется и в дальнейшем при помощи своего устройства голосует.

## Деплой
Нужен Node.js 20 или новее. Ниже сервис слушает `127.0.0.1:3050`.

```bash
cd /opt/mafia
npm install
npm install --prefix client
npm run build --prefix client
```
Проверка без nginx:
```bash
NODE_ENV=production PORT=3050 node server/index.js
```

Без `NODE_ENV=production` Express не отдаёт собранный клиент, остаются только `/api` и `/ws`. `npm start` клиент собирает, но переменную не ставит, поэтому в сервисе лучше вызывать `node` напрямую.

### systemd
`/etc/systemd/system/mafia.service`:
```ini
[Unit]
Description=Mafia
After=network.target
[Service]
WorkingDirectory=/opt/mafia
Environment=NODE_ENV=production
Environment=PORT=3050
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mafia
```
