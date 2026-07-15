/* Minimal OverlayPlugin API glue for Cupidity.
 *
 * Supports both hosting modes, same as cactbot's common.js:
 *  - embedded: the overlay runs inside OverlayPlugin's CEF browser and talks
 *    through window.OverlayPluginApi;
 *  - WebSocket: the page runs in any browser and connects to OverlayPlugin's
 *    WSServer via a ?OVERLAY_WS=ws://127.0.0.1:10501/ws query parameter.
 *
 * Exposes: addOverlayListener(event, cb), startOverlayEvents(),
 *          callOverlayHandler(msg) → Promise.
 */
'use strict';
(function () {
  const subscribers = {};
  const responsePromises = {};
  let rseqCounter = 0;
  let queue = []; // messages buffered until the transport is ready
  let sendMessage = null; // (msg, resolve|null) once ready

  function dispatch(msg) {
    if (!msg || !msg.type) return;
    const subs = subscribers[msg.type];
    if (!subs) return;
    for (const cb of subs) {
      try {
        cb(msg);
      } catch (e) {
        console.error('cupidity: listener error', e);
      }
    }
  }

  function subscribeMessage() {
    return { call: 'subscribe', events: Object.keys(subscribers) };
  }

  const wsMatch = /[?&]OVERLAY_WS=([^&]+)/.exec(window.location.search);
  if (wsMatch) {
    // ---- WebSocket mode ----
    const url = decodeURIComponent(wsMatch[1]);
    let ws = null;

    const connect = () => {
      ws = new WebSocket(url);
      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        if (msg.rseq !== undefined && responsePromises[msg.rseq]) {
          responsePromises[msg.rseq](msg);
          delete responsePromises[msg.rseq];
        } else {
          dispatch(msg);
        }
      });
      ws.addEventListener('open', () => {
        const pending = queue;
        queue = null;
        ws.send(JSON.stringify(subscribeMessage()));
        for (const [msg] of pending) ws.send(JSON.stringify(msg));
        document.documentElement.classList.remove('disconnected');
      });
      ws.addEventListener('close', () => {
        queue = queue || [];
        document.documentElement.classList.add('disconnected');
        setTimeout(connect, 1000);
      });
      ws.addEventListener('error', () => ws.close());
    };

    sendMessage = (msg) => {
      if (queue) queue.push([msg, null]);
      else ws.send(JSON.stringify(msg));
    };

    window.callOverlayHandler = (msg) => {
      msg.rseq = rseqCounter++;
      return new Promise((resolve) => {
        responsePromises[msg.rseq] = resolve;
        sendMessage(msg);
      });
    };

    connect();
  } else {
    // ---- Embedded (CEF) mode ----
    const waitForApi = () => {
      if (!window.OverlayPluginApi || !window.OverlayPluginApi.ready) {
        setTimeout(waitForApi, 300);
        return;
      }
      window.__OverlayCallback = dispatch;
      const pending = queue;
      queue = null;
      window.OverlayPluginApi.callHandler(JSON.stringify(subscribeMessage()), null);
      for (const [msg, resolve] of pending) sendMessage(msg, resolve);
    };

    sendMessage = (msg, resolve) => {
      if (queue) {
        queue.push([msg, resolve]);
        return;
      }
      window.OverlayPluginApi.callHandler(JSON.stringify(msg), (data) => {
        if (resolve) resolve(data == null || data === '' ? null : JSON.parse(data));
      });
    };

    window.callOverlayHandler = (msg) =>
      new Promise((resolve) => sendMessage(msg, resolve));

    waitForApi();
  }

  window.addOverlayListener = (event, cb) => {
    if (!subscribers[event]) {
      subscribers[event] = [];
      // Transport already up → extend the subscription.
      if (queue === null) sendMessage(subscribeMessage(), null);
    }
    subscribers[event].push(cb);
  };

  // Kept for API familiarity; subscription is (re)sent on connect.
  window.startOverlayEvents = () => {
    if (queue === null) sendMessage(subscribeMessage(), null);
  };
})();
