// --- CONFIGURATION ---
const INITIAL_LIVES = 3;
const TIME_PER_ROUND = 5000; // 5 seconds per round

// --- DATA SOURCE (The "Content") ---
let scenarios = [];

// --- AUDIO ---
let audioCtx = null;

// --- STATE MANAGEMENT ---
let gameState = {
    score: 0,
    lives: INITIAL_LIVES,
    currentScenarioIndex: 0,
    timer: null
};

// --- DOM ELEMENTS ---
const screens = {
    start: document.getElementById('start-screen'),
    game: document.getElementById('game-screen'),
    result: document.getElementById('result-screen')
};

const ui = {
    lives: document.getElementById('lives-count'),
    score: document.getElementById('score-count'),
    timer: document.getElementById('timer-bar'),
    media: document.getElementById('media-content'),
    endScore: document.getElementById('final-score'),
    insight: document.getElementById('insight-text')
};

// --- CORE FUNCTIONS ---

async function loadScenarios() {
    const response = await fetch('scenario.json', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to load scenario.json (${response.status})`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
        throw new Error('Scenario data is not an array');
    }

    scenarios = data;
}

function init() {
    const startBtn = document.getElementById('start-btn');

    startBtn.addEventListener('click', startGame);
    document.getElementById('restart-btn').addEventListener('click', resetGame);
    document.addEventListener('pointerdown', ensureAudioContext, { once: true });

    document.querySelectorAll('.choice-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleChoice(e.target.dataset.type));
    });

    startBtn.disabled = true;
    loadScenarios()
        .then(() => {
            startBtn.disabled = false;
        })
        .catch((err) => {
            console.error('Scenario load failed:', err);
            startBtn.textContent = 'Load Failed';
        });
}

function startGame() {
    ensureAudioContext();

    if (!scenarios.length) {
        return;
    }

    // Reset State
    gameState.score = 0;
    gameState.lives = INITIAL_LIVES;
    gameState.currentScenarioIndex = 0;

    // Shuffle Scenarios (optional)
    scenarios.sort(() => Math.random() - 0.5);

    updateHUD();
    switchScreen('game');
    loadRound();
}

function switchScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
    screens[screenName].classList.add('active');
}

function loadRound() {
    if (gameState.currentScenarioIndex >= scenarios.length) {
        endGame("Simulation Complete.");
        return;
    }

    const currentData = scenarios[gameState.currentScenarioIndex];

    // Clear previous media
    ui.media.innerHTML = '';

    // Render Media
    if (currentData.type === 'image') {
        const img = document.createElement('img');
        img.src = currentData.src;
        ui.media.appendChild(img);
    } else if (currentData.type === 'text') {
        const p = document.createElement('p');
        const textValue = currentData.src ?? currentData.content ?? '';
        p.textContent = textValue;
        p.style.padding = "20px";
        ui.media.appendChild(p);
    }

    startTimer();
}

function startTimer() {
    ui.timer.style.transition = 'none';
    ui.timer.style.width = '100%';

    // Force reflow
    void ui.timer.offsetWidth;

    ui.timer.style.transition = `width ${TIME_PER_ROUND}ms linear`;
    ui.timer.style.width = '0%';

    clearTimeout(gameState.timer);
    gameState.timer = setTimeout(() => {
        handleLoss("Time Expired");
    }, TIME_PER_ROUND);
}

function handleChoice(userChoice) {
    clearTimeout(gameState.timer);

    const currentData = scenarios[gameState.currentScenarioIndex];
    const isAi = currentData.isAI ?? currentData.isAi;
    const userChoseAi = userChoice === 'ai';

    if (userChoseAi === isAi) {
        // CORRECT
        gameState.score++;
        flashFeedback('green');
        nextRound();
    } else {
        // WRONG
        handleLoss("Incorrect Classification");
    }
}

function handleLoss(reason) {
    gameState.lives--;
    updateHUD();
    flashFeedback('red');

    if (gameState.lives <= 0) {
        endGame(reason);
    } else {
        // Slight delay before next round so they see the error flash
        setTimeout(nextRound, 500);
    }
}

function nextRound() {
    gameState.currentScenarioIndex++;
    updateHUD();
    loadRound();
}

function updateHUD() {
    ui.lives.textContent = "♥".repeat(gameState.lives);
    ui.score.textContent = gameState.score;
}

function flashFeedback(color) {
    const borderColor = color === 'green' ? 'var(--accent-real)' : 'var(--accent-ai)';
    document.getElementById('app-container').style.borderColor = borderColor;
    playFeedbackSound(color);
    setTimeout(() => {
        document.getElementById('app-container').style.borderColor = 'var(--ui-border)';
    }, 300);
}

function ensureAudioContext() {
    if (audioCtx) {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
        return;
    }

    audioCtx = new Ctx();
}

function playFeedbackSound(color) {
    if (!audioCtx) {
        return;
    }

    const now = audioCtx.currentTime;

    if (color === 'green') {
        playTone(620, now, 0.06, 'triangle', 0.05);
        playTone(880, now + 0.05, 0.1, 'triangle', 0.06);
        return;
    }

    playTone(220, now, 0.09, 'sawtooth', 0.065);
    playTone(155, now + 0.08, 0.12, 'sawtooth', 0.06);
}

function playTone(frequency, startTime, duration, waveType, peakVolume) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = waveType;
    osc.frequency.setValueAtTime(frequency, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakVolume, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
}

function endGame(lastReason) {
    ui.endScore.textContent = gameState.score;
    // This is the "Mirror" message
    switchScreen('result');
}

function resetGame() {
    switchScreen('start');
}

// Start the engine
init();
