(() => {
  const boardElement = document.getElementById("board");
  const modeSelector = document.getElementById("mode");
  const restartBtn = document.getElementById("restart");
  const statusElement = document.getElementById("status");
  const cards = { 1: document.getElementById("p1card"), 2: document.getElementById("p2card") };
  const scoreElements = { 1: document.getElementById("p1score"), 2: document.getElementById("p2score") };
  const nameElements = { 1: document.getElementById("p1name"), 2: document.getElementById("p2name") };
  const muteButton = document.getElementById("mute");

  const GRID = 6;

  const music = new Audio("background_music.mp3");
  music.loop = true;
  music.volume = 0.05;

  // State
  let H, V; // For the lines, stores coordinates via H[r][c], the value is the player who owns it (0 = empty) 
  let boxes; // Each box stores its owner and point value.
  let claimedBoxes;
  let current; // Current player (1 or 2)
  let scores;
  let mode;
  let names;
  let busy; // Used for CPU mid move
  let over;
  let lastSelected = null;
  let els; // DOM refs: { h, v, box }
  let cpuTimer = null;

  // ---------- Setup ----------
  function newGame() {
    clearTimeout(cpuTimer);
    mode = modeSelector.value;
    if (mode === "cpu") {
      names = { 1: "You", 2: "Computer" };
    } else {
      names = { 1: "Player 1", 2: "Player 2" };
    }
    H = grid(GRID + 1, GRID);
    V = grid(GRID, GRID + 1);
    boxes = grid(GRID, GRID).map(row => row.map(() => ({
      owner: 0,
      value: Math.floor(Math.random() * 5) + 1
    })));
    current = 1;
    scores = { 1: 0, 2: 0 };
    claimedBoxes = 0;
    busy = false;
    over = false;
    lastSelected = null;
    nameElements[1].textContent = names[1];
    nameElements[2].textContent = names[2];
    buildBoard();
    updateUI();
  }

  function updateMusic() {
    if (music.paused) {
     music.play();
    } else {
     music.pause();
    }
  }

  function grid(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(0));
  }

  function buildBoard() {
    boardElement.innerHTML = "";
    boardElement.classList.remove("over", "locked");
    els = { h: grid(GRID + 1, GRID), v: grid(GRID, GRID + 1), box: grid(GRID, GRID) };
    sizeBoard();

    for (let gr = 0; gr <= 2 * GRID; gr++) {
      for (let gc = 0; gc <= 2 * GRID; gc++) {
        const evenR = gr % 2 === 0, evenC = gc % 2 === 0;
        let el;
        if (evenR && evenC) {
          el = document.createElement("div");
          el.className = "dot";
        } else if (evenR && !evenC) {
          const r = gr / 2, c = (gc - 1) / 2;
          el = lineButton("h", r, c);
          els.h[r][c] = el;
        } else if (!evenR && evenC) {
          const r = (gr - 1) / 2, c = gc / 2;
          el = lineButton("v", r, c);
          els.v[r][c] = el;
        } else {
          const r = (gr - 1) / 2, c = (gc - 1) / 2;
          el = document.createElement("div");
          el.className = "box";
          el.textContent = boxes[r][c].value;
          el.setAttribute("aria-label", `${boxes[r][c].value} points`);
          els.box[r][c] = el;
        }
        boardElement.appendChild(el);
      }
    }
  }

  function lineButton(t, r, c) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `line ${t}`;
    b.setAttribute("aria-label", `${t === "h" ? "Horizontal" : "Vertical"} line, row ${r + 1}, column ${c + 1}`);
    b.addEventListener("click", () => onHumanMove({ t, r, c }));
    return b;
  }

  function sizeBoard() {
    const avail = Math.min(window.innerWidth - 64, 520);
    const line = Math.max(28, Math.min(72, Math.floor((avail - (GRID + 1) * 14) / GRID)));
    boardElement.style.setProperty("--line", line + "px");
    boardElement.style.gridTemplateColumns = `repeat(${GRID}, var(--dot) var(--line)) var(--dot)`;
    boardElement.style.gridTemplateRows    = `repeat(${GRID}, var(--dot) var(--line)) var(--dot)`;
  }

  // ---------- Rules helpers (work on any H/V so the AI can simulate) ----------
  function isTaken(h, v, m) {
    return m.t === "h" ? h[m.r][m.c] !== 0 : v[m.r][m.c] !== 0;
  }

  function setLine(h, v, m, p) {
    if (m.t === "h") h[m.r][m.c] = p; else v[m.r][m.c] = p;
  }

  function sides(h, v, r, c) {
    return (h[r][c] ? 1 : 0) + (h[r + 1][c] ? 1 : 0) + (v[r][c] ? 1 : 0) + (v[r][c + 1] ? 1 : 0);
  }

  function adjacentBoxes(m) {
    const a = [];
    if (m.t === "h") {
      if (m.r > 0) a.push([m.r - 1, m.c]);
      if (m.r < GRID) a.push([m.r, m.c]);
    } else {
      if (m.c > 0) a.push([m.r, m.c - 1]);
      if (m.c < GRID) a.push([m.r, m.c]);
    }
    return a;
  }

  function availableMoves(h, v) {
    const moves = [];
    for (let r = 0; r <= GRID; r++) for (let c = 0; c < GRID; c++) if (!h[r][c]) moves.push({ t: "h", r, c });
    for (let r = 0; r < GRID; r++) for (let c = 0; c <= GRID; c++) if (!v[r][c]) moves.push({ t: "v", r, c });
    return moves;
  }

  // How many boxes would this move complete?
  function completes(h, v, m) {
    return adjacentBoxes(m).filter(([r, c]) => sides(h, v, r, c) === 3).length;
  }

  // Would this move leave a box with 3 sides (handing it to the opponent)?
  function isUnsafe(h, v, m) {
    return adjacentBoxes(m).some(([r, c]) => sides(h, v, r, c) === 2);
  }

  // ---------- Playing a move ----------
  function onHumanMove(m) {
    if (busy) return;
    if (mode === "cpu" && current === 2) return;
    play(m);
  }

  function play(m) {
    if (isTaken(H, V, m)) return;

    setLine(H, V, m, current);
    const el = m.t === "h" ? els.h[m.r][m.c] : els.v[m.r][m.c];
    el.classList.add("taken", `p${current}`);
    el.setAttribute("aria-disabled", "true");
    if (lastSelected) lastSelected.classList.remove("last");
    el.classList.add("last");
    lastSelected = el;

    let claimed = 0;
    for (const [r, c] of adjacentBoxes(m)) {
      const box = boxes[r][c];
      if (!box.owner && sides(H, V, r, c) === 4) {
        box.owner = current;
        scores[current] += box.value;
        claimedBoxes++;
        claimed++;
        const b = els.box[r][c];
        b.classList.add(`p${current}`);
        b.setAttribute("aria-label", `${box.value} points, claimed by ${names[current]}`);
      }
    }

    if (claimedBoxes === GRID * GRID) {
      over = true;
      updateUI();
      return;
    }

    if (!claimed) current = current === 1 ? 2 : 1;
    updateUI();

    if (mode === "cpu" && current === 2) {
      busy = true;
      boardElement.classList.add("locked");
      cpuTimer = setTimeout(() => {
        busy = false;
        boardElement.classList.remove("locked");
        play(chooseCpuMove());
      }, 450);
    }
  }

  function chooseCpuMove() {
    const moves = availableMoves(H, V);

    // 1. Take any box that can be completed.
    const scoring = moves.filter(m => completes(H, V, m) > 0);
    if (scoring.length) return pick(scoring);

    // 2. Play a move that doesn't give the opponent a box.
    const safe = moves.filter(m => !isUnsafe(H, V, m));
    if (safe.length) return pick(safe);

    // 3. Forced to give something away: give the smallest chain.
    let best = [], bestCost = Infinity;
    for (const m of moves) {
      const cost = giveawayCost(m);
      if (cost < bestCost) { bestCost = cost; best = [m]; }
      else if (cost === bestCost) best.push(m);
    }
    return pick(best);
  }

  // Simulate: play m, then let the opponent greedily take every box available.
  function giveawayCost(m) {
    const h = H.map(row => row.slice());
    const v = V.map(row => row.slice());
    setLine(h, v, m, 2);
    let total = 0, found = true;
    while (found) {
      found = false;
      for (const mm of availableMoves(h, v)) {
        const k = completes(h, v, mm);
        if (k) { setLine(h, v, mm, 1); total += k; found = true; break; }
      }
    }
    return total;
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ---------- UI ----------
  function updateUI() {
    scoreElements[1].textContent = scores[1];
    scoreElements[2].textContent = scores[2];
    boardElement.dataset.turn = current;
    cards[1].classList.toggle("active", !over && current === 1);
    cards[2].classList.toggle("active", !over && current === 2);
    statusElement.classList.toggle("win", over);

    if (over) {
      boardElement.classList.add("over");
      if (scores[1] === scores[2]) statusElement.textContent = "It's a draw!";
      else {
        const w = scores[1] > scores[2] ? 1 : 2;
        statusElement.textContent = mode === "cpu"
          ? (w === 1 ? "You win! 🎉" : "Computer wins!")
          : `${names[w]} wins! 🎉`;
      }
    } else if (mode === "cpu") {
      statusElement.textContent = current === 1 ? "Your turn" : "Computer is thinking…";
    } else {
      statusElement.textContent = `${names[current]}'s turn`;
    }
  }

  // ---------- Events ----------
  restartBtn.addEventListener("click", newGame);
  modeSelector.addEventListener("change", newGame);
  muteButton.addEventListener("pointerdown", updateMusic);

  newGame();
})();
