import { WebSocketServer } from 'ws';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import open from 'open';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.static(__dirname));

const server = app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Server is running at ${url}`);
    open(url);
});

const wss = new WebSocketServer({ server });
const games = {};

function generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

wss.on('connection', (ws) => {
    let gameCode;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'create':
                handleCreateGame(ws, data);
                break;
            case 'join':
                handleJoinGame(ws, data);
                break;
            case 'number':
                handleNumberSubmission(data);
                break;
            case 'timeout':
                handleTimeout(data);
                break;
        }
    });

    function handleCreateGame(ws, data) {
        gameCode = generateGameCode();
        games[gameCode] = {
            players: [{ username: data.username, socket: ws, score: 0, number: null }],
            timerActive: false,
            round: 0
        };
        ws.send(JSON.stringify({ type: 'gameCode', gameCode }));
    }

    function handleJoinGame(ws, data) {
        const game = games[data.gameCode];
        if (game && game.players.length < 2) {
            game.players.push({ username: data.username, socket: ws, score: 0, number: null });

            game.players.forEach((player, index) => {
                player.socket.send(
                    JSON.stringify({
                        type: 'start',
                        playerNumber: index + 1,
                        opponent: game.players[index === 0 ? 1 : 0].username,
                    })
                );
            });
        }
    }

    function handleNumberSubmission(data) {
        const game = games[data.gameCode];
        if (!game) return;

        const player = game.players[data.playerNumber - 1];
        player.number = data.number;

        if (game.players.every((p) => p.number !== null)) {
            calculateResult(data.gameCode);
        }
    }

    function handleTimeout(data) {
        const game = games[data.gameCode];
        if (!game) return;

        game.players.forEach((player) => {
            if (player.number === null) {
                player.score -= 1;
            }
        });

        game.players.forEach((player) => {
            player.socket.send(
                JSON.stringify({
                    type: 'timeout',
                    scores: game.players.map((p) => p.score),
                })
            );
        });

        // Reset for the next round
        startNextRound(game);
    }

    function calculateResult(gameCode) {
        const game = games[gameCode];
        const numbers = game.players.map((p) => p.number || 0);
        const average = numbers.reduce((sum, num) => sum + num, 0) / 2;
        const target = average * 0.8;

        const winnerIndex = numbers
            .map((num) => Math.abs(num - target))
            .indexOf(Math.min(...numbers.map((num) => Math.abs(num - target))));

        game.players.forEach((player, index) => {
            if (index !== winnerIndex) {
                player.score -= 1;
            }
        });

        game.players.forEach((player) => {
            player.socket.send(
                JSON.stringify({
                    type: 'result',
                    numbers,
                    average,
                    target,
                    winner: winnerIndex + 1,
                    scores: game.players.map((p) => p.score),
                })
            );
        });

        // Start the next round after a delay
        setTimeout(() => startNextRound(game), 2000);
    }

    function startNextRound(game) {
        game.players.forEach((player) => {
            player.number = null;
        });

        game.players.forEach((player) => {
            player.socket.send(
                JSON.stringify({
                    type: 'roundStart',
                })
            );
        });
    }

    ws.on('close', () => {
        if (gameCode && games[gameCode]) {
            delete games[gameCode];
        }
    });
});
