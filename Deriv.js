
/* =========================================
   ORBISFX MARKET ENGINE
   File: deriv.js
   Purpose: Live Deriv ticks + digit analysis
   ========================================= */

(() => {
  "use strict";

  const CONFIG = {
    // Replace with your registered Deriv App ID if needed.
    appId: window.ORBIS_DERIV_APP_ID || "1089",
    symbol: "1HZ10V",
    historyLimit: 100,
    reconnectDelay: 3000
  };

  let socket = null;
  let reconnectTimer = null;
  let pingTimer = null;
  let stopped = false;
  let ticks = [];
  let requestId = 1;

  const state = {
    connected: false,
    symbol: CONFIG.symbol,
    latestPrice: null,
    latestDigit: null,
    tickCount: 0,
    digits: Array(10).fill(0),
    lastError: ""
  };

  function emit(name, detail) {
    window.dispatchEvent(
      new CustomEvent("orbis:" + name, { detail })
    );
  }

  function setStatus(status, message = "") {
    state.connected = status === "connected";
    state.lastError = message;

    emit("status", {
      status,
      message,
      connected: state.connected
    });

    const el = document.getElementById("connectionStatus");
    if (el) el.textContent = message || status;
  }

  function getLastDigit(quote, precision) {
    const decimals = Number.isInteger(precision)
      ? Math.max(0, Math.min(precision, 10))
      : 2;

    const formatted = Number(quote).toFixed(decimals);
    const digitsOnly = formatted.replace(/\D/g, "");

    return Number(digitsOnly.slice(-1));
  }

  function updateAnalysis(tick) {
    const precision = Number(tick.pip_size ?? 2);
    const price = Number(tick.quote);

    if (!Number.isFinite(price)) return;

    const digit = getLastDigit(price, precision);

    const item = {
      symbol: tick.symbol || state.symbol,
      price,
      digit,
      epoch: tick.epoch || Math.floor(Date.now() / 1000),
      precision
    };

    ticks.push(item);

    if (ticks.length > CONFIG.historyLimit) {
      ticks.shift();
    }

    state.latestPrice = price;
    state.latestDigit = digit;
    state.tickCount++;
    state.digits = Array(10).fill(0);

    ticks.forEach(t => {
      state.digits[t.digit]++;
    });

    const analysis = {
      ...state,
      digits: [...state.digits],
      ticks: ticks.map(t => ({ ...t })),
      sampleSize: ticks.length,
      frequencies: state.digits.map((count, digit) => ({
        digit,
        count,
        percentage: ticks.length
          ? Number((count / ticks.length * 100).toFixed(2))
          : 0
      }))
    };

    emit("tick", item);
    emit("analysis", analysis);

    const priceEl = document.getElementById("latestPrice");
    const digitEl = document.getElementById("latestDigit");
    const countEl = document.getElementById("tickCount");

    if (priceEl) priceEl.textContent = price.toFixed(precision);
    if (digitEl) digitEl.textContent = String(digit);
    if (countEl) countEl.textContent = String(ticks.length);

    for (let d = 0; d <= 9; d++) {
      const el = document.getElementById("digit-" + d);
      if (el) el.textContent = String(state.digits[d]);
    }
  }

  function send(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify({
      ...data,
      req_id: requestId++
    }));

    return true;
  }

  function subscribe() {
    send({
      ticks: state.symbol,
      subscribe: 1
    });
  }

  function connect() {
    stopped = false;
    clearTimeout(reconnectTimer);
    clearInterval(pingTimer);

    setStatus("connecting", "Connecting to Deriv...");

    try {
      socket = new WebSocket(
        "wss://ws.derivws.com/websockets/v3?app_id=" +
        encodeURIComponent(CONFIG.appId)
      );
    } catch (error) {
      setStatus("error", error.message);
      scheduleReconnect();
      return;
    }

    socket.addEventListener("open", () => {
      setStatus("connected", "Connected");
      subscribe();

      pingTimer = setInterval(() => {
        send({ ping: 1 });
      }, 30000);
    });

    socket.addEventListener("message", event => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error) {
        setStatus("error", data.error.message || "Deriv API error");
        emit("error", data.error);
        return;
      }

      if (data.msg_type === "tick" && data.tick) {
        updateAnalysis(data.tick);
      }
    });

    socket.addEventListener("error", () => {
      setStatus("error", "WebSocket error. Check App ID and connection.");
    });

    socket.addEventListener("close", event => {
      clearInterval(pingTimer);

      setStatus(
        "disconnected",
        "Disconnected (code " + event.code + ")"
      );

      if (!stopped) scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, CONFIG.reconnectDelay);
  }

  function changeSymbol(symbol) {
    if (!symbol || typeof symbol !== "string") return;

    state.symbol = symbol;
    ticks = [];
    state.digits = Array(10).fill(0);
    state.latestPrice = null;
    state.latestDigit = null;

    emit("symbol", { symbol });

    if (socket && socket.readyState === WebSocket.OPEN) {
      send({ forget_all: "ticks" });
      subscribe();
    }
  }

  function disconnect() {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearInterval(pingTimer);
    reconnectTimer = null;

    if (socket) {
      socket.close();
      socket = null;
    }

    setStatus("disconnected", "Disconnected by user");
  }

  window.OrbisDeriv = {
    connect,
    disconnect,
    changeSymbol,
    getState: () => ({
      ...state,
      digits: [...state.digits],
      ticks: ticks.map(t => ({ ...t }))
    })
  };

  // Start automatically when the file loads.
  connect();
})();
