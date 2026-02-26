/* ═══════════════════════════════════════════════════════════
   Checkers Online – Client
   ═══════════════════════════════════════════════════════════ */

const socket = io();

// ── State ────────────────────────────────────────────────────
let myPlayerIndex   = null;
let gameState       = null;
let selectedCell    = null;
let validMoves      = [];
let hasVotedRematch = false;

// ── DOM refs ─────────────────────────────────────────────────
const screens = {
  lobby:   document.getElementById('lobby'),
  waiting: document.getElementById('waiting'),
  game:    document.getElementById('game'),
};

const $ = id => document.getElementById(id);

// ── Utility: show screen ─────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

// ── Utility: delay as Promise ─────────────────────────────────
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── Utility: set status bar ───────────────────────────────────
function setStatus(msg, isMyTurn = false) {
  const bar = $('statusBar');
  bar.textContent = msg;
  bar.classList.toggle('your-turn', isMyTurn);
}

// ─────────────────────────────────────────────────────────────
// LOBBY BUTTON HANDLERS
// ─────────────────────────────────────────────────────────────

$('createRoomBtn').addEventListener('click', async () => {
  try {
    $('createRoomBtn').disabled = true;
    $('lobbyMessage').textContent = 'Creating room...';
    await delay(50); // yield to let UI update before emitting
    socket.emit('createRoom');
  } catch (err) {
    $('lobbyMessage').textContent = `Error: ${err.message}`;
  } finally {
    $('createRoomBtn').disabled = false;
  }
});

$('joinRoomBtn').addEventListener('click', async () => {
  try {
    const roomId = $('roomInput').value.trim().toUpperCase();
    if (!roomId) {
      $('lobbyMessage').textContent = 'Please enter a room code.';
      return;
    }
    $('joinRoomBtn').disabled = true;
    $('lobbyMessage').textContent = 'Joining room...';
    await delay(50); // yield to let UI update before emitting
    socket.emit('joinRoom', { roomId });
  } catch (err) {
    $('lobbyMessage').textContent = `Error: ${err.message}`;
  } finally {
    $('joinRoomBtn').disabled = false;
  }
});

$('copyCodeBtn').addEventListener('click', async () => {
  try {
    const code = $('displayRoomId').textContent;
    await navigator.clipboard.writeText(code);
    $('copyCodeBtn').textContent = 'Copied!';
  } catch {
    $('copyCodeBtn').textContent = 'Copy failed';
  } finally {
    await delay(2000);
    $('copyCodeBtn').textContent = 'Copy Code';
  }
});

$('rematchBtn').addEventListener('click', async () => {
  if (hasVotedRematch) return;
  try {
    hasVotedRematch = true;
    $('rematchBtn').disabled = true;
    await delay(50);
    socket.emit('rematchVote');
  } catch (err) {
    console.error('Rematch vote error:', err);
  }
});

$('backToLobbyBtn').addEventListener('click', () => {
  location.reload();
});

// ─────────────────────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────────────────────

// Room created — we are player 1, now waiting
socket.on('roomCreated', async ({ roomId, playerIndex }) => {
  myPlayerIndex = playerIndex;
  $('displayRoomId').textContent = roomId;
  await delay(80);
  showScreen('waiting');
});

// We joined as player 2
socket.on('roomJoined', async ({ playerIndex }) => {
  myPlayerIndex = playerIndex;
  showScreen('game');
  await delay(80);
  setStatus('Game starting...');
});

// Player 1 is told someone joined
socket.on('opponentJoined', async () => {
  showScreen('game');
  await delay(80);
  setStatus('Opponent joined! Game starting...');
});

// Room/join error
socket.on('joinError', ({ message }) => {
  $('lobbyMessage').textContent = `Error: ${message}`;
});

// Game started or restarted
socket.on('gameStart', async ({ gameState: gs }) => {
  gameState       = gs;
  selectedCell    = null;
  validMoves      = [];
  hasVotedRematch = false;

  $('rematchBtn').disabled = false;
  $('gameOverOverlay').classList.add('hidden');
  $('rematchProgress').textContent = '0 / 2 want a rematch';

  if (myPlayerIndex === 1) {
    $('player1Label').textContent = 'You (Dark)';
    $('player2Label').textContent = 'Opponent (Light)';
  } else {
    $('player1Label').textContent = 'You (Light)';
    $('player2Label').textContent = 'Opponent (Dark)';
    document.querySelector('#player1Card .piece-preview').className = 'piece-preview opponent-piece';
    document.querySelector('#player2Card .piece-preview').className = 'piece-preview my-piece';
  }

  await delay(100);
  renderGame();
});

// Game state update after a move
socket.on('gameStateUpdate', ({ gameState: gs }) => {
  gameState    = gs;
  selectedCell = null;
  validMoves   = [];
  renderGame();
});

// Invalid move feedback
socket.on('invalidMove', async () => {
  setStatus('Invalid move!', false);
  await delay(800);
  renderGame();
});

// Rematch vote progress
socket.on('rematchVoteUpdate', ({ votes }) => {
  $('rematchProgress').textContent = `${votes} / 2 want a rematch`;
});

// Opponent disconnected
socket.on('opponentDisconnected', () => {
  $('disconnectedOverlay').classList.remove('hidden');
});

// ─────────────────────────────────────────────────────────────
// GAME LOGIC HELPERS (client-side, for valid move highlighting)
// ─────────────────────────────────────────────────────────────

function getValidMovesForPiece(board, row, col, mustJumpFrom) {
  const piece = board[row][col];
  if (!piece) return [];
  const player = (piece === 1 || piece === 3) ? 1 : 2;
  const isKing = piece === 3 || piece === 4;
  const dirs   = [];

  if (player === 1 || isKing) dirs.push([-1, -1], [-1, 1]);
  if (player === 2 || isKing) dirs.push([1, -1],  [1, 1]);

  const jumps = [], moves = [];

  for (const [dr, dc] of dirs) {
    const nr = row + dr, nc = col + dc;
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
    const target  = board[nr][nc];
    const isEnemy = target && ((player === 1 && (target === 2 || target === 4)) ||
                               (player === 2 && (target === 1 || target === 3)));
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
  return jumps.length ? jumps : moves;
}

function getAllMovesForPlayer(board, player, mustJumpFrom) {
  const all = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p  = board[r][c];
      if (!p) continue;
      const pp = (p === 1 || p === 3) ? 1 : 2;
      if (pp !== player) continue;
      all.push(...getValidMovesForPiece(board, r, c, mustJumpFrom));
    }
  }
  // Mandatory capture: if any jump is available anywhere, only jumps are legal
  const jumps = all.filter(m => m.captured);
  return jumps.length ? jumps : all;
}

// ─────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────

function renderGame() {
  if (!gameState) return;
  const { board, currentTurn, winner, mustJumpFrom } = gameState;
  const isMyTurn = (currentTurn === myPlayerIndex) && !winner;

  if (winner) {
    const won = winner === myPlayerIndex;
    setStatus(won ? '🎉 You won!' : '😞 You lost.', false);
    showGameOver(won);
  } else {
    setStatus(isMyTurn ? 'Your turn' : "Opponent's turn", isMyTurn);
  }

  $('player1Card').classList.toggle('active-turn', currentTurn === myPlayerIndex && !winner);
  $('player2Card').classList.toggle('active-turn', currentTurn !== myPlayerIndex && !winner);

  const allMyMoves = isMyTurn
    ? getAllMovesForPlayer(board, myPlayerIndex, mustJumpFrom)
    : [];

  const selectedDestinations = selectedCell
    ? getValidMovesForPiece(board, selectedCell.row, selectedCell.col, mustJumpFrom)
        .map(m => ({ row: m.to[0], col: m.to[1], move: m }))
    : [];

  const boardEl = $('board');
  boardEl.innerHTML = '';

  let p1pieces = 0, p2pieces = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p === 1 || p === 3) p1pieces++;
      if (p === 2 || p === 4) p2pieces++;
    }
  renderCaptured(12 - p2pieces, 12 - p1pieces);

  const flip = myPlayerIndex === 2;

  for (let visualRow = 0; visualRow < 8; visualRow++) {
    for (let visualCol = 0; visualCol < 8; visualCol++) {
      const row = flip ? 7 - visualRow : visualRow;
      const col = flip ? 7 - visualCol : visualCol;

      const cell = document.createElement('div');
      cell.className  = `cell ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
      cell.dataset.row = row;
      cell.dataset.col = col;

      const piece         = board[row][col];
      const isSelected    = selectedCell && selectedCell.row === row && selectedCell.col === col;
      const isDest        = selectedDestinations.find(d => d.row === row && d.col === col);
      const isHighlighted = mustJumpFrom && mustJumpFrom[0] === row && mustJumpFrom[1] === col;
      const isMyPiece     = piece && ((myPlayerIndex === 1 && (piece === 1 || piece === 3)) ||
                                      (myPlayerIndex === 2 && (piece === 2 || piece === 4)));
      const isSelectable  = isMyTurn && isMyPiece &&
                            allMyMoves.some(m => m.from[0] === row && m.from[1] === col);

      if (isHighlighted) cell.classList.add('highlighted');

      if (isDest) {
        cell.classList.add('valid-move');
        if (piece) cell.classList.add('has-piece');
        cell.addEventListener('click', () => handleMoveClick(isDest.move));
      }

      if (piece) {
        const pieceEl   = document.createElement('div');
        const player    = (piece === 1 || piece === 3) ? 1 : 2;
        pieceEl.className = `piece p${player}${(piece === 3 || piece === 4) ? ' king' : ''}${isSelected ? ' selected' : ''}`;

        if (isSelectable) {
          pieceEl.addEventListener('click', (e) => {
            e.stopPropagation();
            handlePieceClick(row, col);
          });
        }
        cell.appendChild(pieceEl);
      }

      boardEl.appendChild(cell);
    }
  }
}

function handlePieceClick(row, col) {
  if (!gameState || gameState.currentTurn !== myPlayerIndex || gameState.winner) return;
  const moves = getValidMovesForPiece(gameState.board, row, col, gameState.mustJumpFrom);
  if (!moves.length) return;

  selectedCell = (selectedCell && selectedCell.row === row && selectedCell.col === col)
    ? null
    : { row, col };

  validMoves = moves;
  renderGame();
}

function handleMoveClick(move) {
  if (!gameState || gameState.currentTurn !== myPlayerIndex) return;
  selectedCell = null;
  validMoves   = [];
  socket.emit('makeMove', { move });
}

function showGameOver(won) {
  $('gameOverTitle').textContent    = won ? '🎉 You Won!' : '😞 You Lost';
  $('gameOverSubtitle').textContent = won
    ? 'Congratulations! You captured all opponent pieces.'
    : 'Better luck next time!';
  $('gameOverOverlay').classList.remove('hidden');
}

function renderCaptured(capturedByP1, capturedByP2) {
  const byP1 = $('capturedByP1');
  const byP2 = $('capturedByP2');
  byP1.innerHTML = '';
  byP2.innerHTML = '';

  for (let i = 0; i < capturedByP1; i++) {
    const d = document.createElement('div');
    d.className = 'captured-piece p2';
    byP1.appendChild(d);
  }
  for (let i = 0; i < capturedByP2; i++) {
    const d = document.createElement('div');
    d.className = 'captured-piece p1';
    byP2.appendChild(d);
  }
}
