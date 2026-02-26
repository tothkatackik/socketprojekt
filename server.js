const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// rooms: { roomId: { players: [socketId, socketId], gameState, rematchVotes } }
const rooms = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createInitialBoard() {
  // 8x8 board, row 0 top
  // 1 = player1 (dark pieces, rows 5-7), 2 = player2 (light pieces, rows 0-2)
  // 3 = king player1, 4 = king player2
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) board[row][col] = 2;
    }
  }
  for (let row = 5; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) board[row][col] = 1;
    }
  }
  return board;
}

function createGameState() {
  return {
    board: createInitialBoard(),
    currentTurn: 1, // player 1 starts
    winner: null,
    mustJumpFrom: null, // [row, col] if a piece must continue jumping
  };
}

function getValidMoves(board, row, col, mustJumpFrom) {
  const piece = board[row][col];
  if (!piece) return [];
  const player = piece === 1 || piece === 3 ? 1 : 2;
  const isKing = piece === 3 || piece === 4;
  const directions = [];

  if (player === 1 || isKing) directions.push([-1, -1], [-1, 1]);
  if (player === 2 || isKing) directions.push([1, -1], [1, 1]);

  const jumps = [];
  const moves = [];

  for (const [dr, dc] of directions) {
    const nr = row + dr, nc = col + dc;
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
    const target = board[nr][nc];
    const isEnemy = target && ((player === 1 && (target === 2 || target === 4)) || (player === 2 && (target === 1 || target === 3)));
    if (isEnemy) {
      const jr = row + 2 * dr, jc = col + 2 * dc;
      if (jr >= 0 && jr <= 7 && jc >= 0 && jc <= 7 && !board[jr][jc]) {
        jumps.push({ from: [row, col], to: [jr, jc], captured: [nr, nc] });
      }
    } else if (!target && !mustJumpFrom) {
      moves.push({ from: [row, col], to: [nr, nc], captured: null });
    }
  }

  if (mustJumpFrom) {
    if (mustJumpFrom[0] === row && mustJumpFrom[1] === col) return jumps;
    return [];
  }

  return jumps.length > 0 ? jumps : moves;
}

function getAllValidMoves(board, player, mustJumpFrom) {
  const all = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const piecePlayer = piece === 1 || piece === 3 ? 1 : 2;
      if (piecePlayer !== player) continue;
      all.push(...getValidMoves(board, r, c, mustJumpFrom));
    }
  }
  // Mandatory capture: if any jump is available anywhere, only jumps are legal
  const jumps = all.filter(m => m.captured);
  return jumps.length ? jumps : all;
}

function applyMove(gameState, move) {
  const { board } = gameState;
  const { from, to, captured } = move;
  const [fr, fc] = from;
  const [tr, tc] = to;

  const piece = board[fr][fc];
  board[fr][fc] = 0;
  if (captured) board[captured[0]][captured[1]] = 0;

  let newPiece = piece;
  if (piece === 1 && tr === 0) newPiece = 3;
  if (piece === 2 && tr === 7) newPiece = 4;
  board[tr][tc] = newPiece;

  let mustJumpFrom = null;
  if (captured && newPiece === piece) {
    const furtherJumps = getValidMoves(board, tr, tc, [tr, tc]).filter(m => m.captured);
    if (furtherJumps.length > 0) mustJumpFrom = [tr, tc];
  }

  if (!mustJumpFrom) {
    gameState.currentTurn = gameState.currentTurn === 1 ? 2 : 1;
    gameState.mustJumpFrom = null;
  } else {
    gameState.mustJumpFrom = mustJumpFrom;
  }

  const nextPlayer = gameState.currentTurn;
  const allMoves = getAllValidMoves(board, nextPlayer, gameState.mustJumpFrom);
  if (allMoves.length === 0) {
    gameState.winner = nextPlayer === 1 ? 2 : 1;
  }

  return gameState;
}

// ── Async helper: wrap setTimeout as a Promise ───────────────
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── Async helper: validate and register a new room ──────────
async function createRoom(socket) {
  const roomId = generateRoomId();
  rooms[roomId] = {
    players: [socket.id],
    gameState: null,
    rematchVotes: new Set(),
  };
  socket.join(roomId);
  socket.roomId = roomId;
  socket.playerIndex = 1;
  return roomId;
}

// ── Async helper: validate and join an existing room ────────
async function joinRoom(socket, roomId) {
  const room = rooms[roomId];
  if (!room) throw new Error('Room not found');
  if (room.players.length >= 2) throw new Error('Room is full');
  room.players.push(socket.id);
  socket.join(roomId);
  socket.roomId = roomId;
  socket.playerIndex = 2;
  room.gameState = createGameState();
  return room;
}

// ── Async helper: process a rematch vote ────────────────────
async function processRematchVote(socket) {
  const room = rooms[socket.roomId];
  if (!room) throw new Error('Room not found');
  room.rematchVotes.add(socket.id);
  io.to(socket.roomId).emit('rematchVoteUpdate', { votes: room.rematchVotes.size });

  if (room.rematchVotes.size >= 2) {
    room.gameState = createGameState();
    room.rematchVotes.clear();
    await delay(300);
    io.to(socket.roomId).emit('gameStart', {
      gameState: room.gameState,
      players: room.players,
    });
  }
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Create room
  socket.on('createRoom', async () => {
    try {
      const roomId = await createRoom(socket);
      socket.emit('roomCreated', { roomId, playerIndex: 1 });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Join room
  socket.on('joinRoom', async ({ roomId }) => {
    try {
      const room = await joinRoom(socket, roomId);
      socket.emit('roomJoined', { roomId, playerIndex: 2 });

      const p1Socket = io.sockets.sockets.get(room.players[0]);
      if (p1Socket) p1Socket.emit('opponentJoined');

      await delay(500);
      io.to(roomId).emit('gameStart', {
        gameState: room.gameState,
        players: room.players,
      });
    } catch (err) {
      socket.emit('joinError', { message: err.message });
    }
  });

  // Make move
  socket.on('makeMove', async ({ move }) => {
    try {
      const room = rooms[socket.roomId];
      if (!room || !room.gameState) return;
      const gs = room.gameState;
      if (gs.winner || gs.currentTurn !== socket.playerIndex) return;

      const valid = getAllValidMoves(gs.board, socket.playerIndex, gs.mustJumpFrom);
      const isValid = valid.some(m =>
        m.from[0] === move.from[0] && m.from[1] === move.from[1] &&
        m.to[0] === move.to[0]     && m.to[1] === move.to[1]
      );

      if (!isValid) {
        socket.emit('invalidMove');
        return;
      }

      applyMove(gs, move);
      io.to(socket.roomId).emit('gameStateUpdate', { gameState: gs });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Rematch vote
  socket.on('rematchVote', async () => {
    try {
      await processRematchVote(socket);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      io.to(roomId).emit('opponentDisconnected');
      delete rooms[roomId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Checkers server running on http://localhost:${PORT}`));
