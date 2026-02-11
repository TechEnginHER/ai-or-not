// --- CONFIGURATION ---
const INITIAL_LIVES = 3;
const TIME_PER_ROUND = 5000; // 5 seconds per round
const IMAGE_LOAD_TIMEOUT_MS = 10000;

// --- DATA SOURCE (The "Content") ---
let scenarios = [];
const preloadedImagePromises = new Map();

// --- AUDIO ---
let audioCtx = null;

// --- STATE MANAGEMENT ---
let gameState = {
    score: 0,
    lives: INITIAL_LIVES,
    currentScenarioIndex: 0,
    timer: null,
    acceptingInput: false
};

// --- DOM ELEMENTS ---
const screens = {
    start: document.getElementById('start-screen'),
    game: document.getElementById('game-screen'),
    result: document.getElementById('result-screen')
};

const ui = {
    startBtn: document.getElementById('start-btn'),
    restartBtn: document.getElementById('restart-btn'),
    lives: document.getElementById('lives-count'),
    score: document.getElementById('score-count'),
    timer: document.getElementById('timer-bar'),
    media: document.getElementById('media-content'),
    roundLoader: document.getElementById('round-loader'),
    endScore: document.getElementById('final-score')
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
    ui.startBtn.addEventListener('click', () => {
        startGame().catch((err) => {
            console.error('Game start failed:', err);
            ui.startBtn.disabled = false;
            ui.startBtn.textContent = 'Begin';
        });
    });
    ui.restartBtn.addEventListener('click', resetGame);
    document.addEventListener('pointerdown', ensureAudioContext, { once: true });

    document.querySelectorAll('.choice-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => handleChoice(e.target.dataset.type));
    });

    ui.startBtn.disabled = true;
    ui.startBtn.textContent = 'Loading';

    loadScenarios()
        .then(() => preloadScenarioAssets(scenarios))
        .then(() => {
            ui.startBtn.disabled = false;
            ui.startBtn.textContent = 'Begin';
        })
        .catch((err) => {
            console.error('Scenario load failed:', err);
            ui.startBtn.textContent = 'Load Failed';
        });
}

async function startGame() {
    ensureAudioContext();

    if (!scenarios.length) {
        return;
    }

    ui.startBtn.disabled = true;
    ui.startBtn.textContent = 'Syncing...';

    // Reset state
    clearTimeout(gameState.timer);
    gameState.score = 0;
    gameState.lives = INITIAL_LIVES;
    gameState.currentScenarioIndex = 0;
    gameState.acceptingInput = false;

    // Shuffle scenarios (optional)
    scenarios.sort(() => Math.random() - 0.5);

    updateHUD();
    disableChoiceButtons(true);
    resetTimerVisual();

    // Load first playable round before switching to game screen.
    await loadRound({ initial: true });
    ui.startBtn.disabled = false;
    ui.startBtn.textContent = 'Begin';
}

function switchScreen(screenName) {
    Object.values(screens).forEach((s) => {
        s.classList.add('hidden');
        s.classList.remove('active');
    });
    screens[screenName].classList.remove('hidden');
    screens[screenName].classList.add('active');
}

async function loadRound({ initial = false } = {}) {
    if (gameState.currentScenarioIndex >= scenarios.length) {
        endGame('Simulation Complete.');
        return;
    }

    clearTimeout(gameState.timer);
    gameState.acceptingInput = false;
    disableChoiceButtons(true);
    resetTimerVisual();
    setRoundLoader(!initial);
    ui.media.innerHTML = '';

    const currentData = scenarios[gameState.currentScenarioIndex];

    try {
        const mediaNode = await createRoundMediaNode(currentData);
        ui.media.appendChild(mediaNode);
    } catch (err) {
        console.error('Media failed to load, skipping scenario:', currentData?.src, err);
        gameState.currentScenarioIndex++;
        return loadRound({ initial });
    }

    if (initial) {
        switchScreen('game');
    }

    setRoundLoader(false);
    disableChoiceButtons(false);
    startTimer();
}

function startTimer() {
    gameState.acceptingInput = true;
    resetTimerVisual();
    void ui.timer.offsetWidth; // Force reflow
    ui.timer.style.transition = `width ${TIME_PER_ROUND}ms linear`;
    ui.timer.style.width = '0%';

    clearTimeout(gameState.timer);
    gameState.timer = setTimeout(() => {
        handleLoss('Time Expired');
    }, TIME_PER_ROUND);
}

function handleChoice(userChoice) {
    if (!gameState.acceptingInput) {
        return;
    }

    gameState.acceptingInput = false;
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
        handleLoss('Incorrect Classification');
    }
}

function handleLoss(reason) {
    gameState.acceptingInput = false;
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
    loadRound().catch((err) => {
        console.error('Round load failed:', err);
        endGame('Media Pipeline Failure');
    });
}

function updateHUD() {
    ui.lives.textContent = '\u2665'.repeat(gameState.lives);
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

async function preloadScenarioAssets(items) {
    const imageSources = [...new Set(items
        .filter((item) => item.type === 'image' && item.src)
        .map((item) => item.src))];

    if (!imageSources.length) {
        return;
    }

    const tasks = imageSources.map((src) => getOrCreatePreloadPromise(src)
        .catch((err) => {
            console.error('Preload failed:', src, err);
        }));

    await Promise.all(tasks);
}

function getOrCreatePreloadPromise(src) {
    if (!preloadedImagePromises.has(src)) {
        preloadedImagePromises.set(src, loadImageElement(src, IMAGE_LOAD_TIMEOUT_MS));
    }
    return preloadedImagePromises.get(src);
}

async function createRoundMediaNode(roundData) {
    if (roundData.type === 'image') {
        // Await boot-time preload first; if it failed, still retry a fresh load for this round.
        await getOrCreatePreloadPromise(roundData.src).catch(() => {});
        return loadImageElement(roundData.src, IMAGE_LOAD_TIMEOUT_MS);
    }

    const p = document.createElement('p');
    p.textContent = roundData.src ?? roundData.content ?? '';
    p.style.padding = '20px';
    return p;
}

function loadImageElement(src, timeoutMs) {
    return new Promise((resolve, reject) => {
        const img = document.createElement('img');
        let done = false;

        const finish = (error) => {
            if (done) {
                return;
            }

            done = true;
            clearTimeout(timeoutId);
            img.onload = null;
            img.onerror = null;

            if (error) {
                reject(error);
                return;
            }

            resolve(img);
        };

        const markReady = () => {
            const decodePromise = typeof img.decode === 'function'
                ? img.decode().catch(() => {})
                : Promise.resolve();
            decodePromise.finally(() => finish(null));
        };

        const timeoutId = setTimeout(() => {
            finish(new Error(`Image load timeout: ${src}`));
        }, timeoutMs);

        img.alt = 'Classification sample';
        img.decoding = 'async';
        img.loading = 'eager';
        img.onload = markReady;
        img.onerror = () => finish(new Error(`Image failed to load: ${src}`));
        img.src = src;

        if (img.complete && img.naturalWidth > 0) {
            markReady();
        }
    });
}

function disableChoiceButtons(disabled) {
    document.querySelectorAll('.choice-btn').forEach((btn) => {
        btn.disabled = disabled;
    });
}

function setRoundLoader(visible) {
    ui.roundLoader.classList.toggle('hidden', !visible);
}

function resetTimerVisual() {
    ui.timer.style.transition = 'none';
    ui.timer.style.width = '100%';
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
    clearTimeout(gameState.timer);
    gameState.acceptingInput = false;
    disableChoiceButtons(true);
    setRoundLoader(false);

    ui.endScore.textContent = gameState.score;
    switchScreen('result');
}

function resetGame() {
    clearTimeout(gameState.timer);
    gameState.acceptingInput = false;
    disableChoiceButtons(false);
    setRoundLoader(false);
    ui.startBtn.disabled = false;
    ui.startBtn.textContent = 'Begin';
    switchScreen('start');
}

// Start the engine
init();
