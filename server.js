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
            players: [
                { username: data.username, socket: ws, score: 0, number: null }
            ],
            isTimeout: false,
            round: 0,
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

            startNextRound(game);
        }
    }

    function handleNumberSubmission(data) {
        const game = games[data.gameCode];
        if (!game) return;

        const player = game.players[data.playerNumber - 1];
        player.number = data.number;

        if (game.players.every((p) => p.number !== null) && !game.isTimeout) {
            calculateResult(data.gameCode);
        }
    }

    function handleTimeout(data) {
        const game = games[data.gameCode];
        if (!game) return;

        game.isTimeout = true;

        // Deduct points only for players who didn't choose a number
        game.players.forEach((player) => {
            if (player.number === null) {
                player.score -= 1;
                checkGameOver(game);
            }
        });

        // Send current scores to all players
        game.players.forEach((player) => {
            player.socket.send(
                JSON.stringify({
                    type: 'timeout',
                    scores: game.players.map((p) => p.score),
                })
            );
        });

        if (!checkGameOver(game)) {
            setTimeout(() => startNextRound(game), 2000);
        }
    }

    function calculateResult(gameCode) {
        const game = games[gameCode];
        if (game.isTimeout) return;

        const numbers = game.players.map((p) => p.number);
        const average = numbers.reduce((sum, num) => sum + num, 0) / 2;
        const target = average * 0.8;

        const winnerIndex = game.players
            .map((p, i) => ({ diff: Math.abs(p.number - target), index: i }))
            .reduce((min, curr) => (curr.diff < min.diff ? curr : min), { diff: Infinity, index: -1 })
            .index;

        if (winnerIndex !== -1) {
            game.players.forEach((player, index) => {
                if (index !== winnerIndex) {
                    player.score -= 1;
                    checkGameOver(game);
                }
            });
        }

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

        if (!checkGameOver(game)) {
            setTimeout(() => startNextRound(game), 2000);
        }
    }

    function checkGameOver(game) {
        const loserIndex = game.players.findIndex(player => player.score <= -10);
        
        if (loserIndex !== -1) {
            // Get the winner (the other player)
            const winnerIndex = loserIndex === 0 ? 1 : 0;
            const winner = game.players[winnerIndex].username;
            
            // Send game over message to both players
            game.players.forEach((player) => {
                player.socket.send(
                    JSON.stringify({
                        type: 'gameOver',
                        winner: winner
                    })
                );
            });

            // Clean up the game
            delete games[gameCode];
            return true;
        }
        return false;
    }

    function startNextRound(game) {
        game.players.forEach((player) => {
            player.number = null;
        });
        game.isTimeout = false;

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
