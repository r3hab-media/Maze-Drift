const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');

const GAME_W = 480;
const GAME_H = 800;
let scale = 1;
const view = { scale: 1, offsetX: 0, offsetY: 0 };
const BASE_RADIUS = 6;
const MAX_LIVES = 5;
const MIN_LIVES = 1;
let runTime = 0;
let fontsReady = false;

const GAP_EASY = { base: 190, min: 170, max: 230 };
const GAP_HARD = { base: 135, min: 110, max: 175 };

const ball = {
  x: GAME_W / 2,
  y: GAME_H - 120,
  targetX: GAME_W / 2,
  radius: BASE_RADIUS * MAX_LIVES,
  speed: 9,
};

const maze = {
  segments: [],
  segmentHeight: 64,
  gapWidth: GAP_EASY.base,
  minGap: GAP_EASY.min,
  maxGap: GAP_EASY.max,
  speed: 110,
  accel: 8,
};

const controls = {
  pauseBtn: document.getElementById('pause-btn'),
  restartBtn: document.getElementById('restart-btn'),
  themeBtn: document.getElementById('theme-btn'),
};

const colors = {
  bgTop: '#0f172a',
  bgBottom: '#020617',
  wall: '#0f172a',
  accent: '#fbbf24',
  text: '#e5e7eb',
};

let lastTime = performance.now();
let state = 'ready'; // ready | running | over
let score = 0;
let highScore = Number(localStorage.getItem('maze-drift-best') || 0);
let collisionGuard = 0;
let lives = MAX_LIVES;
highScoreEl.textContent = highScore;

function setCanvasSize() {
  const targetRatio = GAME_H / GAME_W;
  const maxWidth = Math.min(window.innerWidth - 24, 720);
  let width = Math.max(320, maxWidth);
  let height = width * targetRatio;
  const maxHeight = window.innerHeight - 140;
  if (height > maxHeight) {
    height = Math.max(360, maxHeight);
    width = height / targetRatio;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const viewWidth = rect.width;
  const viewHeight = rect.height;
  view.scale = Math.min(viewWidth / GAME_W, viewHeight / GAME_H);
  view.offsetX = (viewWidth - GAME_W * view.scale) / 2;
  view.offsetY = (viewHeight - GAME_H * view.scale) / 2;
  ctx.setTransform(
    view.scale * dpr,
    0,
    0,
    view.scale * dpr,
    view.offsetX * dpr,
    view.offsetY * dpr
  );
  drawFrame(0); // redraw static overlay on resize
}

function resetGame() {
  ball.x = GAME_W / 2;
  ball.targetX = ball.x;
  lives = MAX_LIVES;
  ball.radius = BASE_RADIUS * lives;
  maze.segments = [];
  maze.speed = 110;
  runTime = 0;
  const count = Math.ceil(GAME_H / maze.segmentHeight) + 4;
  let y = GAME_H - maze.segmentHeight * 2;
  let bottomGap = { center: GAME_W / 2, width: GAP_EASY.base };
  for (let i = 0; i < count; i++) {
    const seg = makeSegment(y, bottomGap, getGapSettings());
    maze.segments.unshift(seg); // build upward so index 0 is the topmost
    bottomGap = { center: seg.topCenter, width: seg.topWidth };
    y -= maze.segmentHeight;
  }
  score = 0;
  scoreEl.textContent = '0';
}

function makeSegment(y, bottomGap, gapSettings) {
  const widthTop = clamp(
    gapSettings.baseWidth + (Math.random() * 40 - 20),
    gapSettings.minGap,
    gapSettings.maxGap
  );
  const maxOffset = 70;
  const centerMin = widthTop / 2 + 6;
  const centerMax = GAME_W - widthTop / 2 - 6;
  const centerTop = clamp(bottomGap.center + (Math.random() * 2 - 1) * maxOffset, centerMin, centerMax);
  return {
    y,
    topCenter: centerTop,
    topWidth: widthTop,
    bottomCenter: bottomGap.center,
    bottomWidth: bottomGap.width,
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function worldXFromClient(clientX) {
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const world = (px - view.offsetX) / view.scale;
  return clamp(world, ball.radius, GAME_W - ball.radius);
}

function update(dt) {
  if (state !== 'running') {
    return;
  }

  runTime += dt;

  // speed ramp
  const speedBoost = 0.6 + 0.4 * difficultyProgress();
  maze.speed += maze.accel * dt * speedBoost;
  // ball movement toward target
  const dx = ball.targetX - ball.x;
  ball.x += dx * ball.speed * dt;

  // scroll segments
  for (const seg of maze.segments) {
    seg.y += maze.speed * dt;
  }

  // recycle segments
  const bottom = maze.segments[maze.segments.length - 1];
  if (bottom.y > GAME_H + maze.segmentHeight) {
    maze.segments.pop();
    const top = maze.segments[0];
    const connectGap = { center: top.topCenter, width: top.topWidth };
    maze.segments.unshift(makeSegment(top.y - maze.segmentHeight, connectGap, getGapSettings()));
  }

  score += dt * 10;
  scoreEl.textContent = Math.floor(score);

  collisionGuard = Math.max(0, collisionGuard - dt);
  if (collisionGuard === 0) {
    checkCollision();
  }
}

function checkCollision() {
  const radius = ball.radius;
  const forgiveness = 4;
  for (const seg of maze.segments) {
    if (ball.y + radius < seg.y || ball.y - radius > seg.y + maze.segmentHeight) {
      continue;
    }
    const t = clamp((ball.y - seg.y) / maze.segmentHeight, 0, 1);
    const gapCenter = lerp(seg.topCenter, seg.bottomCenter, t);
    const gapWidth = lerp(seg.topWidth, seg.bottomWidth, t);
    const gapStart = gapCenter - gapWidth / 2 + forgiveness;
    const gapEnd = gapCenter + gapWidth / 2 - forgiveness;
    registerHitIfNeeded(gapStart, gapEnd);
    return; // only check one overlapping segment
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function registerHitIfNeeded(gapStart, gapEnd) {
  const radius = ball.radius;
  const overlapLeft = gapStart - (ball.x - radius);
  const overlapRight = (ball.x + radius) - gapEnd;
  if (overlapLeft > 0 || overlapRight > 0) {
    if (collisionGuard > 0) return;
    lives = Math.max(0, lives - 1);
    if (lives > 0) {
      ball.radius = BASE_RADIUS * lives;
      ball.x = clamp(ball.x, ball.radius, GAME_W - ball.radius);
    }
    collisionGuard = 0.35;
    if (lives <= 0) {
      gameOver();
    }
  }
}

function difficultyProgress() {
  return clamp(runTime / 45, 0, 1);
}

function getGapSettings() {
  const t = difficultyProgress();
  return {
    baseWidth: lerp(GAP_EASY.base, GAP_HARD.base, t),
    minGap: lerp(GAP_EASY.min, GAP_HARD.min, t),
    maxGap: lerp(GAP_EASY.max, GAP_HARD.max, t),
  };
}

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, GAME_H);
  grad.addColorStop(0, colors.bgTop);
  grad.addColorStop(1, colors.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, GAME_W, GAME_H);
}

function drawMaze() {
  for (const seg of maze.segments) {
    const y = seg.y;
    const h = maze.segmentHeight;
    const topLeft = seg.topCenter - seg.topWidth / 2;
    const topRight = seg.topCenter + seg.topWidth / 2;
    const botLeft = seg.bottomCenter - seg.bottomWidth / 2;
    const botRight = seg.bottomCenter + seg.bottomWidth / 2;

    ctx.fillStyle = colors.wall;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(topLeft, y);
    ctx.lineTo(botLeft, y + h);
    ctx.lineTo(0, y + h);
    ctx.closePath();
    ctx.fill();

    // right wall polygon
    ctx.beginPath();
    ctx.moveTo(topRight, y);
    ctx.lineTo(GAME_W, y);
    ctx.lineTo(GAME_W, y + h);
    ctx.lineTo(botRight, y + h);
    ctx.closePath();
    ctx.fill();

    // divider lines to emphasize trail
    ctx.strokeStyle = hexToRgba(colors.accent, 0.35);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(topLeft, y);
    ctx.lineTo(botLeft, y + h);
    ctx.moveTo(topRight, y);
    ctx.lineTo(botRight, y + h);
    ctx.stroke();
  }
}

function drawBall() {
  drawBallCircle();
}

function drawOverlay() {
  ctx.save();
  ctx.fillStyle = 'rgba(2,6,23,0.7)';
  ctx.fillRect(40, GAME_H / 2 - 140, GAME_W - 80, 280);
  ctx.strokeStyle = hexToRgba(colors.accent, 0.7);
  ctx.lineWidth = 2;
  ctx.strokeRect(40, GAME_H / 2 - 140, GAME_W - 80, 280);

  ctx.fillStyle = colors.text;
  ctx.textAlign = 'center';
  ctx.font = 'bold 40px "Space Grotesk", sans-serif';
  const title = state === 'over' ? 'Game Over' : state === 'paused' ? 'Paused' : 'Maze Drift';
  ctx.fillText(title, GAME_W / 2, GAME_H / 2 - 70);

  ctx.font = '20px "Space Grotesk", sans-serif';
  if (state === 'ready') {
    ctx.fillText('Drag or press arrows to move.', GAME_W / 2, GAME_H / 2 - 20);
    ctx.fillText('Pass through the gaps. Avoid walls.', GAME_W / 2, GAME_H / 2 + 14);
    ctx.fillText('Press Space, Tap, or Restart', GAME_W / 2, GAME_H / 2 + 60);
  } else if (state === 'over') {
    ctx.fillText(`Score: ${Math.floor(score)}`, GAME_W / 2, GAME_H / 2 - 10);
    ctx.fillText(`Best: ${highScore}`, GAME_W / 2, GAME_H / 2 + 26);
    ctx.fillText('Press Space or Tap to Retry', GAME_W / 2, GAME_H / 2 + 70);
  } else if (state === 'paused') {
    ctx.fillText('Game paused', GAME_W / 2, GAME_H / 2 + 10);
    ctx.fillText('Tap resume to continue', GAME_W / 2, GAME_H / 2 + 46);
  }
  ctx.restore();
}

function drawFrame(dt) {
  drawBackground();
  drawMaze();
  drawBall();
  if (state !== 'running') {
    drawOverlay();
  }
}

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  update(dt);
  drawFrame(dt);
  requestAnimationFrame(gameLoop);
}

function gameOver() {
  state = 'over';
  updatePauseButton();
  if (score > highScore) {
    highScore = Math.floor(score);
    localStorage.setItem('maze-drift-best', highScore);
    highScoreEl.textContent = highScore;
  }
}

function startGame() {
  resetGame();
  state = 'running';
  collisionGuard = 0.75; // brief grace to avoid instant collisions
  updatePauseButton();
}

function handlePointer(clientX) {
  ball.targetX = worldXFromClient(clientX);
  if (state === 'ready') {
    startGame();
  } else if (state === 'over') {
    startGame();
  }
}

function handleKey(e) {
  if (e.code === 'Space') {
    if (state === 'running') return;
    startGame();
    return;
  }
  if (state !== 'running') return;
  const nudge = 22;
  if (e.code === 'ArrowLeft') {
    ball.targetX = clamp(ball.targetX - nudge, ball.radius, GAME_W - ball.radius);
  } else if (e.code === 'ArrowRight') {
    ball.targetX = clamp(ball.targetX + nudge, ball.radius, GAME_W - ball.radius);
  }
}

// Input events
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  handlePointer(e.clientX);
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pressure === 0 && e.buttons === 0) return;
  handlePointer(e.clientX);
});

window.addEventListener('keydown', handleKey);
window.addEventListener('resize', setCanvasSize);

controls.pauseBtn?.addEventListener('click', () => {
  if (state === 'running') {
    state = 'paused';
  } else if (state === 'paused') {
    state = 'running';
    lastTime = performance.now();
  }
  updatePauseButton();
});

controls.restartBtn?.addEventListener('click', () => {
  startGame();
});

controls.themeBtn?.addEventListener('click', () => {
  toggleTheme();
});

// Service worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.log('SW registration failed', err);
    });
  });
}

// Init
applySavedTheme();
refreshColors();
setCanvasSize();
resetGame();
updatePauseButton();
requestAnimationFrame(gameLoop);

function toggleTheme() {
  const current = document.documentElement.classList.contains('light') ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  localStorage.setItem('maze-drift-theme', theme);
  refreshColors();
  updateThemeButton();
  drawFrame(0);
}

function applySavedTheme() {
  const saved = localStorage.getItem('maze-drift-theme') || 'dark';
  document.documentElement.classList.toggle('light', saved === 'light');
  updateThemeButton();
}

function refreshColors() {
  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue('--bg').trim() || '#020617';
  colors.bgBottom = bg;
  colors.bgTop = shade(bg, 15);
  colors.wall = style.getPropertyValue('--wall').trim() || colors.wall;
  colors.accent = style.getPropertyValue('--accent').trim() || colors.accent;
  colors.text = style.getPropertyValue('--text').trim() || colors.text;
}

function updateThemeButton() {
  const icon = controls.themeBtn?.querySelector('i');
  if (!icon) return;
  const light = document.documentElement.classList.contains('light');
  icon.className = light ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
}

function updatePauseButton() {
  const icon = controls.pauseBtn?.querySelector('i');
  if (!icon) return;
  if (state === 'running') {
    icon.className = 'fa-solid fa-circle-pause';
  } else {
    icon.className = 'fa-solid fa-circle-play';
  }
}

function hexToRgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function shade(hex, percent) {
  const { r, g, b } = hexToRgb(hex);
  const t = percent / 100;
  const nr = Math.round(r + (percent > 0 ? (255 - r) : r) * t);
  const ng = Math.round(g + (percent > 0 ? (255 - g) : g) * t);
  const nb = Math.round(b + (percent > 0 ? (255 - b) : b) * t);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

function drawBallCircle() {
  const r = ball.radius;
  const g = ctx.createRadialGradient(ball.x - r / 2, ball.y - r / 2, r / 2, ball.x, ball.y, r * 1.4);
  g.addColorStop(0, colors.accent);
  g.addColorStop(1, shade(colors.accent, -30));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
  ctx.fill();
}
