(() => {

  const { createClient } = window.supabase;

  const supabase = createClient(
     "https://xomlgerxdwscrhvwkbep.supabase.co",
     "sb_publishable_UtCf4_dgNi1ZXuS0zEmCBA_awV_jBXU"
  );
  
  const boardEl   = document.getElementById("board");
  const modeSel   = document.getElementById("mode");
  
  const onlinePanel = document.getElementById("onlinePanel");
  const roomCodeInput = document.getElementById("roomCode");
  const createRoomBtn = document.getElementById("createRoom");
  const joinRoomBtn = document.getElementById("joinRoom");
  const onlineStatus = document.getElementById("onlineStatus");

  function updateModePanel() {
   onlinePanel.hidden = modeSel.value !== "online";
  }

  modeSel.addEventListener("change", updateModePanel);
  updateModePanel();


  const restartBt = document.getElementById("restart");
  const statusEl  = document.getElementById("status");
  const cards  = { 1: document.getElementById("p1card"),  2: document.getElementById("p2card") };
  const scoreE = { 1: document.getElementById("p1score"), 2: document.getElementById("p2score") };
  const nameE  = { 1: document.getElementById("p1name"),  2: document.getElementById("p2name") };
  const muteBt = document.getElementById("mute");

  const CPU_DELAY = 450;

  const music = new Audio("background_music.mp3");
  music.loop = true;

  // State
  let R, C;            // rows / columns of boxes
  let H, V;            // H[r][c]: horizontal lines (R+1 x C), V[r][c]: vertical lines (R x C+1); value = player who drew it (0 = empty)
  let boxes;           // boxes[r][c] = owner (0 = unclaimed)
  let current;         // 1 or 2
  let scores;
  let mode;            // "cpu" | "pvp"
  let names;
  let busy;            // true while CPU is moving
  let over;
  let lastEl = null;
  let els;             // DOM refs: { h, v, box }
  let cpuTimer = null;
  let onlinePollTimer = null;
  let onlinePollInFlight = false;

  // ---------- Setup ----------



  function newGame() {
    clearTimeout(cpuTimer);
    R = C = 6;
    mode = modeSel.value;
    names = mode === "cpu" ? { 1: "You", 2: "Computer" } : { 1: "Player 1", 2: "Player 2" };
    H = grid(R + 1, C);
    V = grid(R, C + 1);
    boxes = grid(R, C);
    current = 1;
    scores = { 1: 0, 2: 0 };
    busy = false;
    over = false;
    lastEl = null;
    nameE[1].textContent = names[1];
    nameE[2].textContent = names[2];
    buildBoard();
    updateUI();
  }

  function updateMusic() {
    if (music.paused) {
     music.play().catch(err => console.warn("Music blocked or not found:", err));
    } else {
     music.pause();
    }
  }

  function grid(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(0));
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    boardEl.classList.remove("over", "locked");
    els = { h: grid(R + 1, C), v: grid(R, C + 1), box: grid(R, C) };
    sizeBoard();

    for (let gr = 0; gr <= 2 * R; gr++) {
      for (let gc = 0; gc <= 2 * C; gc++) {
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
          els.box[r][c] = el;
        }
        boardEl.appendChild(el);
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
    const line = Math.max(28, Math.min(72, Math.floor((avail - (C + 1) * 14) / C)));
    boardEl.style.setProperty("--line", line + "px");
    boardEl.style.gridTemplateColumns = `repeat(${C}, var(--dot) var(--line)) var(--dot)`;
    boardEl.style.gridTemplateRows    = `repeat(${R}, var(--dot) var(--line)) var(--dot)`;
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
      if (m.r < R) a.push([m.r, m.c]);
    } else {
      if (m.c > 0) a.push([m.r, m.c - 1]);
      if (m.c < C) a.push([m.r, m.c]);
    }
    return a;
  }

  function availableMoves(h, v) {
    const moves = [];
    for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) if (!h[r][c]) moves.push({ t: "h", r, c });
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) if (!v[r][c]) moves.push({ t: "v", r, c });
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
    if (lastEl) lastEl.classList.remove("last");
    el.classList.add("last");
    lastEl = el;

    let claimed = 0;
    for (const [r, c] of adjacentBoxes(m)) {
      if (!boxes[r][c] && sides(H, V, r, c) === 4) {
        boxes[r][c] = current;
        scores[current]++;
        claimed++;
        const b = els.box[r][c];
        b.classList.add(`p${current}`);
        b.textContent = mode === "cpu" ? names[current][0] : String(current);
      }
    }

    if (scores[1] + scores[2] === R * C) {
      over = true;
      updateUI();
      return;
    }

    if (!claimed) current = current === 1 ? 2 : 1;
    updateUI();

    if (mode === "cpu" && current === 2) {
      busy = true;
      boardEl.classList.add("locked");
      cpuTimer = setTimeout(() => {
        busy = false;
        boardEl.classList.remove("locked");
        play(chooseCpuMove());
      }, CPU_DELAY);
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
    scoreE[1].textContent = scores[1];
    scoreE[2].textContent = scores[2];
    boardEl.dataset.turn = current;
    cards[1].classList.toggle("active", !over && current === 1);
    cards[2].classList.toggle("active", !over && current === 2);
    statusEl.classList.toggle("win", over);

    if (over) {
      boardEl.classList.add("over");
      if (scores[1] === scores[2]) statusEl.textContent = "It's a draw!";
      else {
        const w = scores[1] > scores[2] ? 1 : 2;
        statusEl.textContent = mode === "cpu"
          ? (w === 1 ? "You win! 🎉" : "Computer wins!")
          : `${names[w]} wins! 🎉`;
      }
    } else if (mode === "cpu") {
      statusEl.textContent = current === 1 ? "Your turn" : "Computer is thinking…";
    } else {
      statusEl.textContent = `${names[current]}'s turn`;
    }
  }
  function renderOnlineState(state) {
    if (!state || !state.H || !state.V || !state.boxes) return;

    // Copy the saved board into the game's existing variables.
    H = state.H.map(row => row.slice());
    V = state.V.map(row => row.slice());
    boxes = state.boxes.map(row => row.slice());

    current = Number(state.current);
    scores = {
      1: Number(state.scores[0]),
      2: Number(state.scores[1])
    };
    over = Boolean(state.over);
    busy = false;
    lastEl = null;

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
        el.textContent = "";

        if (boxes[r][c] !== 0) {
          el.classList.add(`p${boxes[r][c]}`);
          el.textContent = String(boxes[r][c]);
        }
      }
    }

    updateUI();
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

    if (current !== playerNumber) {
      onlineStatus.textContent = "It's the other player's turn.";
      return;
    }

    if (isTaken(H, V, m)) return;

    boardEl.classList.add("locked");

    try {
      const { data, error } = await supabase.rpc("make_game_move", {
        p_room_code: roomCode,
        p_player_token: playerToken,
        p_move_type: m.t,
        p_row: m.r,
        p_col: m.c
      });

      if (error) throw error;

      renderOnlineState(data.state);
      onlineStatus.textContent = `Playing in room ${roomCode}.`;
    } catch (error) {
      console.error("Online move failed:", error);
      onlineStatus.textContent =
        "Move wasn't saved. Refresh the game state and try again.";
    } finally {
      boardEl.classList.remove("locked");
    }
  }
  
  async function refreshOnlineState() {
    if (modeSel.value !== "online" || onlinePollInFlight) return;

    const roomCode = sessionStorage.getItem("dotsRoomCode");
    const playerToken = sessionStorage.getItem("dotsPlayerToken");

    if (!roomCode || !playerToken) return;

    onlinePollInFlight = true;

    try {
      const { data, error } = await supabase.rpc("get_game_state", {
        p_room_code: roomCode,
        p_player_token: playerToken
      });

      if (error) throw error;

      // A newly created room has no saved board yet.
      if (data.state && Array.isArray(data.state.H)) {
        renderOnlineState(data.state);
      }
    } catch (error) {
      console.error("Refreshing online state failed:", error);
    } finally {
      onlinePollInFlight = false;
    }
  }

  function startOnlinePolling() {
    clearInterval(onlinePollTimer);
    onlinePollTimer = null;

    refreshOnlineState();
    onlinePollTimer = setInterval(refreshOnlineState, 1500);
  }


  // ---------- Events ----------
  restartBt.addEventListener("click", newGame);
  modeSel.addEventListener("change", newGame);
  muteBt.addEventListener("pointerdown", updateMusic);


  
  createRoomBtn.addEventListener("click", async () => {
  createRoomBtn.disabled = true;
  onlineStatus.textContent = "Creating room...";

  try {
    const { data, error } = await supabase.rpc("create_game_room");

    if (error) {
      throw error;
    }

    sessionStorage.setItem("dotsPlayerToken", data.player_token);
    sessionStorage.setItem("dotsRoomCode", data.room_code);

    roomCodeInput.value = data.room_code;
    onlineStatus.textContent =
      `Room created! Share code ${data.room_code} with your friend.`;
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

      if (error) {
        throw error;
      }

      sessionStorage.setItem("dotsPlayerToken", data.player_token);
      sessionStorage.setItem("dotsRoomCode", data.room_code);
      sessionStorage.setItem("dotsPlayerNumber", String(data.player_number));

      onlineStatus.textContent =
        `Joined room ${data.room_code} as Player 2!`;
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
