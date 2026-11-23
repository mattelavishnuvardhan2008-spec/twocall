(() => {
  const $ = s => document.querySelector(s);
  const remoteVideo = $('#remote'), localVideo = $('#local'), statusEl = $('#status');
  const callBtn = $('#callBtn'), hangBtn = $('#hangBtn'), switchBtn = $('#switchBtn'),
        settingsBtn = $('#settingsBtn'), settingsPanel = $('#settings'), saveBtn = $('#saveBtn'),
        closeBtn = $('#closeBtn');

  const cfg = {
    server: localStorage.getItem('tc_server') || '',
    me:     localStorage.getItem('tc_me')     || '',
    peer:   localStorage.getItem('tc_peer')   || '',
    secret: localStorage.getItem('tc_secret') || '',
  };

  const ICE = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
      }
    ]
  };

  let ws = null, pc = null, localStream = null, remoteStream = null;
  let peerId = null, iceQueue = [], inCall = false, facing = 'user';

  const setStatus = (t, k = '') => { statusEl.textContent = t; statusEl.className = k; };
  const wsSend = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

  function connect() {
    if (!cfg.server || !cfg.me) { setStatus('Open ⚙ to set server + name'); return; }
    try { ws = new WebSocket(cfg.server); } catch { return setStatus('Bad server URL', 'err'); }

    ws.onopen = () => {
      wsSend({ type: 'register', user: cfg.me, secret: cfg.secret });
      
      // Keep-alive ping every 2 minutes to prevent Render from sleeping
      if (window.keepAliveInterval) clearInterval(window.keepAliveInterval);
      window.keepAliveInterval = setInterval(() => {
        if (ws && ws.readyState === 1) {
          wsSend({ type: 'ping' }); 
        }
      }, 2 * 60 * 1000);
    };
    
    ws.onmessage = e => { try { handle(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => { 
      if (window.keepAliveInterval) clearInterval(window.keepAliveInterval);
      if (!inCall) setStatus('Reconnecting…', 'warn'); 
      setTimeout(connect, 2500); 
    };
  }

  async function handle(m) {
    switch (m.type) {
      case 'registered': setStatus('Ready'); break;
      case 'error': setStatus(m.message, 'err'); break;

      case 'call':
      case 'incoming':
        if (inCall) return;
        peerId = m.from; inCall = true;
        document.body.classList.add('incall');
        setStatus('Answering…');
        try {
          await ensureMedia();
          wsSend({ type: 'accept', to: peerId });
        } catch (e) { setStatus('Camera/mic denied', 'err'); endCall(true); }
        break;

      case 'peer-ready':
        await startCall();
        break;

      case 'offer':
        await onOffer(m);
        break;

      case 'answer':
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
        await flushIce();
        setStatus('Connected');
        break;

      case 'ice':
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try { await pc.addIceCandidate(m.candidate); } catch {}
        } else iceQueue.push(m.candidate);
        break;

      case 'bye':
      case 'cancel':
        endCall(false);
        break;
    }
  }

  async function ensureMedia() {
    if (localStream) return;
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    });
    localVideo.srcObject = localStream;
  }

  function createPC() {
    pc = new RTCPeerConnection(ICE);
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    // Force autoplay and unmute
    pc.ontrack = e => { 
      remoteStream.addTrack(e.track); 
      remoteVideo.muted = false;
      remoteVideo.volume = 1.0;
      remoteVideo.play().catch(e => console.log("Play blocked", e)); 
    };
    
    pc.onicecandidate = e => { if (e.candidate) wsSend({ type: 'ice', to: peerId, candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { setStatus('Connection failed', 'err'); setTimeout(() => endCall(true), 800); }
    };
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  async function flushIce() {
    for (const c of iceQueue) { try { await pc.addIceCandidate(c); } catch {} }
    iceQueue = [];
  }

  async function startCall() {
    try { await ensureMedia(); } catch { return setStatus('Camera/mic denied', 'err'), endCall(true); }
    document.body.classList.add('incall');
    createPC();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ type: 'offer', to: peerId, sdp: pc.localDescription });
    setStatus('Connecting…');
  }

  async function onOffer(m) {
    if (!inCall) { peerId = m.from; inCall = true; document.body.classList.add('incall'); await ensureMedia(); }
    if (!pc) createPC();
    await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
    await flushIce();
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    wsSend({ type: 'answer', to: peerId, sdp: pc.localDescription });
    setStatus('Connected');
  }

  function endCall(notify) {
    if (notify && peerId) wsSend({ type: 'bye', to: peerId });
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    remoteStream = null; iceQueue = [];
    localVideo.srcObject = null; remoteVideo.srcObject = null;
    inCall = false; peerId = null;
    document.body.classList.remove('incall');
    setStatus('Ready');
  }

  callBtn.onclick = () => {
    if (!cfg.peer) return openSettings();
    peerId = cfg.peer; inCall = true;
    document.body.classList.add('incall');
    setStatus('Calling ' + cfg.peer + '…');
    wsSend({ type: 'call', to: cfg.peer });
  };

  hangBtn.onclick = () => {
    if (peerId && !pc) wsSend({ type: 'cancel', to: peerId });
    endCall(true);
  };

  switchBtn.onclick = async () => {
    if (!localStream) return;
    facing = facing === 'user' ? 'environment' : 'user';
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
    const track = s.getVideoTracks()[0];
    const sender = pc && pc.getSenders().find(x => x.track && x.track.kind === 'video');
    if (sender) await sender.replaceTrack(track);
    const old = localStream.getVideoTracks()[0];
    if (old) { localStream.removeTrack(old); old.stop(); }
    localStream.addTrack(track);
    localVideo.srcObject = localStream;
  };

  function openSettings() {
    $('#sServer').value = cfg.server; $('#sMe').value = cfg.me;
    $('#sPeer').value = cfg.peer;     $('#sSecret').value = cfg.secret;
    settingsPanel.classList.remove('hidden');
  }
  settingsBtn.onclick = openSettings;
  closeBtn.onclick = () => settingsPanel.classList.add('hidden');

  saveBtn.onclick = () => {
    cfg.server = $('#sServer').value.trim();
    cfg.me     = $('#sMe').value.trim();
    cfg.peer   = $('#sPeer').value.trim();
    cfg.secret = $('#sSecret').value;
    for (const k in cfg) localStorage.setItem('tc_' + k, cfg[k]);
    settingsPanel.classList.add('hidden');
    pushConfigToNative();
    if (ws) { try { ws.close(); } catch {} }
    connect();
  };

  function pushConfigToNative() {
    const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CallConfig;
    if (P) P.save({ server: cfg.server, me: cfg.me, secret: cfg.secret }).catch(() => {});
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ws && ws.readyState > 1) connect();
  });

  if (!cfg.server || !cfg.me) openSettings();
  else { pushConfigToNative(); connect(); }
})();