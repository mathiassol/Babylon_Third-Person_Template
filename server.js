const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const players = {};

const saves = {};

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws, req) => {
    const id = uuidv4();
    let ip = req.socket.remoteAddress.replace(/^.*:/, '');

    let alreadyConnected = false;
    wss.clients.forEach((client) => {
        if (
            client !== ws &&
            client.readyState === WebSocket.OPEN &&
            client._ip === ip
        ) {
            alreadyConnected = true;
        }
    });

    if (alreadyConnected) {
        ws.send(JSON.stringify({ type: "error", message: "Another player is already connected from this device/IP." }));
        ws.close();
        return;
    }
    ws._ip = ip;

    let playerName = null;
    let restoredPosition = null;
    if (saves[ip]) {
        restoredPosition = { ...saves[ip].position };
    }


    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'setName') {
                playerName = data.name;

                let position = data.position
                    ? { ...data.position }
                    : restoredPosition
                        ? { ...restoredPosition }
                        : { x: 0, y: 0, z: 0 };

                players[id] = {
                    name: playerName,
                    position: { ...position }
                };
                saves[ip] = { ...players[id] };
                ws.send(JSON.stringify({
                    type: "init",
                    id: id,
                    players: players
                }));
            }
            else if (data.type === 'update') {
                players[id] = {
                    name: playerName,
                    position: { ...data.position }
                };
                saves[ip] = { ...players[id] };
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'update',
                            id: id,
                            position: { ...players[id].position },
                            name: playerName
                        }));
                    }
                });
            }
        } catch (e) {
            console.error("Failed to parse message", e);
        }
    });

    ws.on('close', () => {
        delete players[id];
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'disconnect',
                    id: id
                }));
            }
        });
    });
});

    server.listen(51115, '0.0.0.0', () => {
    console.log('Server listening on port 51115');
});