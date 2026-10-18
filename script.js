(() => {
  const supabase = window.supabase?.createClient(
    "https://xomlgerxdwscrhvwkbep.supabase.co",
    "sb_publishable_UtCf4_dgNi1ZXuS0zEmCBA_awV_jBXU"
  );

  const boardElement = document.getElementById("board");
  const modeSelector = document.getElementById("mode");
  const difficultySelector = document.getElementById("difficulty");
  const difficultyControl = document.getElementById("difficulty-control");
  const onlinePanel = document.getElementById("onlinePanel");
  const roomCodeInput = document.getElementById("roomCode");
  const createRoomBtn = document.getElementById("createRoom");
  const joinRoomBtn = document.getElementById("joinRoom");
  const onlineStatus = document.getElementById("onlineStatus");
  const restartBtn = document.getElementById("restart");
  const statusElement = document.getElementById("status");
  const cards = { 1: document.getElementById("p1card"), 2: document.getElementById("p2card") };
  const scoreElements = { 1: document.getElementById("p1score"), 2: document.getElementById("p2score") };
  const nameElements = { 1: document.getElementById("p1name"), 2: document.getElementById("p2name") };
  const muteButton = document.getElementById("mute");
  const muteIcon = document.getElementById("mute-icon");
  const playerColorInputs = {
    1: document.getElementById("p1-color"),
    2: document.getElementById("p2-color")
  };

  for (const [player, input] of Object.entries(playerColorInputs)) {
    const updatePlayerColor = () => {
      document.documentElement.style.setProperty(`--p${player}`, input.value);
    };
    input.addEventListener("input", updatePlayerColor);
    updatePlayerColor();
  }

  const GRID = 6;

  const music = new Audio("assets/background_music.mp3");
  music.loop = true;

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
  let onlinePollTimer = null;
  let onlinePollInFlight = false;

  // ---------- Setup ----------
  function newGame() {
    clearTimeout(cpuTimer);
    clearInterval(onlinePollTimer);
    onlinePollTimer = null;
    mode = modeSelector.value;
    difficultyControl.hidden = mode !== "cpu";
    onlinePanel.hidden = mode !== "online";
    restartBtn.hidden = mode === "online";
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
    const roomCode = sessionStorage.getItem("dotsRoomCode");
    const playerToken = sessionStorage.getItem("dotsPlayerToken");
    if (mode === "online" && roomCode && playerToken) {
      setOnlineBoxValues(roomCode);
      startOnlinePolling();
    }
    updateUI();
  }

  function updateMusic() {
    if (music.paused) {
      music.play().then(() => setMusicButtonState(true)).catch(() => setMusicButtonState(false));
    } else {
      music.pause();
      setMusicButtonState(false);
    }
  }

  function setMusicButtonState(isPlaying) {
    const label = isPlaying ? "Mute music" : "Play music";
    if (isPlaying) {
      muteIcon.src = "assets/TINGMuteButton.webp";
    } else {
      muteIcon.src = "assets/TINGMuteButton2.webp";
    }
    muteButton.setAttribute("aria-label", label);
    muteButton.setAttribute("aria-pressed", String(isPlaying));
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

  // Would this move leave a box with 3 sides (handing it to the opponent)?
  function isUnsafe(h, v, m) {
    return adjacentBoxes(m).some(([r, c]) => sides(h, v, r, c) === 2);
  }

  // ---------- Playing a move ----------
  function onHumanMove(m) {
    if (over || busy) return;

    if (mode === "online") {
      submitOnlineMove(m);
      return;
    }

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
    let best;

    // Prefer moves that claim the most points.
    const scoring = moves.map(move => ({ move, points: pointsCompletedBy(H, V, move) }))
      .filter(candidate => candidate.points > 0);
    if (scoring.length) {
      const maxPoints = Math.max(...scoring.map(candidate => candidate.points));
      best = scoring.filter(candidate => candidate.points === maxPoints).map(candidate => candidate.move);
    }

    // Otherwise, avoid giving the opponent a box.
    if (!best) {
      best = moves.filter(m => !isUnsafe(H, V, m));
    }

    // If every move gives something away, minimize the points conceded.
    if (!best.length) {
      let bestCost = Infinity;
      best = [];
      for (const m of moves) {
        const cost = giveawayCost(m);
        if (cost < bestCost) { bestCost = cost; best = [m]; }
        else if (cost === bestCost) best.push(m);
      }
    }

    const bestChance = { easy: 0.5, medium: 0.75, hard: 1 }[difficultySelector.value];
    if (Math.random() < bestChance || best.length === moves.length) return pick(best);
    return pick(moves.filter(move => !best.includes(move)));
  }

  function pointsCompletedBy(h, v, m) {
    return adjacentBoxes(m).reduce((total, [r, c]) => (
      total + (sides(h, v, r, c) === 3 ? boxes[r][c].value : 0)
    ), 0);
  }

  // Simulate: play m, then let the opponent greedily take every box available.
  function giveawayCost(m) {
    const h = H.map(row => row.slice());
    const v = V.map(row => row.slice());
    setLine(h, v, m, 2);
    let total = 0, found = true;
    while (found) {
      found = false;
      let bestMove = null, bestPoints = 0;
      for (const mm of availableMoves(h, v)) {
        const points = pointsCompletedBy(h, v, mm);
        if (points > bestPoints) {
          bestMove = mm;
          bestPoints = points;
        }
      }
      if (bestMove) {
        setLine(h, v, bestMove, 1);
        total += bestPoints;
        found = true;
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
    boardElement.classList.toggle("over", over);

    if (over) {
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
  function renderOnlineState(state) {
    if (!state || !state.H || !state.V || !state.boxes) return;

    H = state.H.map(row => row.slice());
    V = state.V.map(row => row.slice());
    current = Number(state.current);
    boxes = grid(GRID, GRID).map((row, r) => row.map((_, c) => ({
      owner: Number(state.boxes[r][c]),
      value: boxes[r][c].value
    })));
    scores = { 1: 0, 2: 0 };
    claimedBoxes = 0;
    for (const row of boxes) {
      for (const box of row) {
        if (box.owner === 1 || box.owner === 2) {
          scores[box.owner] += box.value;
          claimedBoxes++;
        }
      }
    }
    over = Boolean(state.over) || claimedBoxes === GRID * GRID;
    busy = false;
    lastSelected = null;

    // Redraw horizontal lines.
    for (let r = 0; r < H.length; r++) {
      for (let c = 0; c < H[r].length; c++) {
        const el = els.h[r][c];
        el.classList.remove("taken", "p1", "p2", "last");

        if (H[r][c] !== 0) {
          el.classList.add("taken", `p${H[r][c]}`);
          el.setAttribute("aria-disabled", "true");
        } else {
          el.removeAttribute("aria-disabled");
        }
      }
    }

    // Redraw vertical lines.
    for (let r = 0; r < V.length; r++) {
      for (let c = 0; c < V[r].length; c++) {
        const el = els.v[r][c];
        el.classList.remove("taken", "p1", "p2", "last");

        if (V[r][c] !== 0) {
          el.classList.add("taken", `p${V[r][c]}`);
          el.setAttribute("aria-disabled", "true");
        } else {
          el.removeAttribute("aria-disabled");
        }
      }
    }

    // Redraw completed boxes.
    for (let r = 0; r < boxes.length; r++) {
      for (let c = 0; c < boxes[r].length; c++) {
        const el = els.box[r][c];
        el.classList.remove("p1", "p2");
        el.textContent = String(boxes[r][c].value);
        el.setAttribute("aria-label", `${boxes[r][c].value} points`);

        if (boxes[r][c].owner) {
          el.classList.add(`p${boxes[r][c].owner}`);
          el.setAttribute("aria-label", `${boxes[r][c].value} points, claimed by ${names[boxes[r][c].owner]}`);
        }
      }
    }

    updateUI();
  }

  function setOnlineBoxValues(roomCode) {
    let seed = 0;
    for (const char of roomCode.toUpperCase()) {
      seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
    }

    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        boxes[r][c].value = (seed % 5) + 1;
        els.box[r][c].textContent = String(boxes[r][c].value);
        els.box[r][c].setAttribute("aria-label", `${boxes[r][c].value} points`);
      }
    }
  }

  async function submitOnlineMove(m) {
    const roomCode = sessionStorage.getItem("dotsRoomCode");
    const playerToken = sessionStorage.getItem("dotsPlayerToken");
    const playerNumber = Number(
      sessionStorage.getItem("dotsPlayerNumber") || "1"
    );

    if (!roomCode || !playerToken) {
      onlineStatus.textContent = "Create or join a room first.";
      return;
    }

    if (!supabase) {
      onlineStatus.textContent = "Online multiplayer is unavailable. Please try again later.";
      return;
    }

    if (current !== playerNumber) {
      onlineStatus.textContent = "It's the other player's turn.";
      return;
    }

    if (isTaken(H, V, m)) return;

    busy = true;
    boardElement.classList.add("locked");

    try {
      const { data, error } = await supabase.rpc("make_game_move", {
        p_room_code: roomCode,
        p_player_token: playerToken,
        p_move_type: m.t,
        p_row: m.r,
        p_col: m.c
      });

      if (error) throw error;

      if (modeSelector.value === "online" && sessionStorage.getItem("dotsRoomCode") === roomCode) {
        renderOnlineState(data.state);
        onlineStatus.textContent = `Playing in room ${roomCode}.`;
      }
    } catch (error) {
      console.error("Online move failed:", error);
      onlineStatus.textContent =
        "Move wasn't saved. Refresh the game state and try again.";
    } finally {
      busy = false;
      boardElement.classList.remove("locked");
    }
  }

  async function refreshOnlineState() {
    if (modeSelector.value !== "online" || onlinePollInFlight || busy) return;

    const roomCode = sessionStorage.getItem("dotsRoomCode");
    const playerToken = sessionStorage.getItem("dotsPlayerToken");

    if (!roomCode || !playerToken) return;
    if (!supabase) {
      onlineStatus.textContent = "Online multiplayer is unavailable. Please try again later.";
      return;
    }

    onlinePollInFlight = true;

    try {
      const { data, error } = await supabase.rpc("get_game_state", {
        p_room_code: roomCode,
        p_player_token: playerToken
      });

      if (error) throw error;

      // A newly created room has no saved board yet.
      if (modeSelector.value === "online" &&
          sessionStorage.getItem("dotsRoomCode") === roomCode &&
          data.state && Array.isArray(data.state.H)) {
        renderOnlineState(data.state);
      }
    } catch (error) {
      console.error("Refreshing online state failed:", error);
      onlineStatus.textContent = "Couldn't refresh the game state. Retrying...";
    } finally {
      onlinePollInFlight = false;
    }
  }

  function startOnlinePolling() {
    clearInterval(onlinePollTimer);
    onlinePollTimer = null;
    if (modeSelector.value !== "online") return;

    refreshOnlineState();
    onlinePollTimer = setInterval(refreshOnlineState, 1500);
  }

  // ---------- Events ----------
  restartBtn.addEventListener("click", newGame);
  modeSelector.addEventListener("change", newGame);
  difficultySelector.addEventListener("change", newGame);
  muteButton.addEventListener("click", updateMusic);

  createRoomBtn.addEventListener("click", async () => {
    if (!supabase) {
      onlineStatus.textContent = "Online multiplayer is unavailable. Please try again later.";
      return;
    }

    createRoomBtn.disabled = true;
    onlineStatus.textContent = "Creating room...";

    try {
      const { data, error } = await supabase.rpc("create_game_room");
      if (error) throw error;

      sessionStorage.setItem("dotsPlayerToken", data.player_token);
      sessionStorage.setItem("dotsRoomCode", data.room_code);
      sessionStorage.setItem("dotsPlayerNumber", "1");

      roomCodeInput.value = data.room_code;
      setOnlineBoxValues(data.room_code);
      onlineStatus.textContent = `Room created! Share code ${data.room_code} with your friend.`;
      startOnlinePolling();
    } catch (error) {
      console.error("Create room failed:", error);
      onlineStatus.textContent =
        "Couldn't create the room. Check the browser console for details.";
    } finally {
      createRoomBtn.disabled = false;
    }
  });

  joinRoomBtn.addEventListener("click", async () => {
    if (!supabase) {
      onlineStatus.textContent = "Online multiplayer is unavailable. Please try again later.";
      return;
    }

    const roomCode = roomCodeInput.value.trim().toUpperCase();
    if (!roomCode) {
      onlineStatus.textContent = "Please enter a room code.";
      return;
    }

    joinRoomBtn.disabled = true;
    onlineStatus.textContent = "Joining room...";

    try {
      const { data, error } = await supabase.rpc("join_game_room", {
        p_room_code: roomCode
      });
      if (error) throw error;

      sessionStorage.setItem("dotsPlayerToken", data.player_token);
      sessionStorage.setItem("dotsRoomCode", data.room_code);
      sessionStorage.setItem("dotsPlayerNumber", String(data.player_number));

      setOnlineBoxValues(data.room_code);
      onlineStatus.textContent = `Joined room ${data.room_code} as Player 2!`;
      startOnlinePolling();
    } catch (error) {
      console.error("Join room failed:", error);
      onlineStatus.textContent =
        "Couldn't join the room. Check the code and try again.";
    } finally {
      joinRoomBtn.disabled = false;
    }
  });

  newGame();
})();