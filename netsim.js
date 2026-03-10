// @ts-nocheck
// ════════════════════════════════════════════════════════════
// CORE STATE
// ════════════════════════════════════════════════════════════
const cvs = document.getElementById('cvs');
const cx = cvs.getContext('2d');
const dLayer = document.getElementById('device-layer');

let nodes = [], cables = [];
let selNode = null, mode = 'design';
let cableMode = false, deleteMode = false, docMode = false;
let cableFirst = null, dragNode = null, dragOff = { x: 0, y: 0 };
let ctxTarget = null, nextId = 1, cmdNode = null;
let captureActive = false;
let captureLog = [];
let cmdHistory = [], cmdHistIdx = -1;
// Zoom & pan
let zoom = 1.0, panX = 0, panY = 0;
let isPanning = false, panStart = { x: 0, y: 0 };
let zoomTimer = null;

// App state
let dnsEntries = {}; // hostname -> ip
let dnsRunning = false, dnsServerNode = null;
let dhcpRunning = false, dhcpServerNode = null, dhcpPool = {};
let wsNodes = {};  // nodeId -> { running: bool, content: string }  ← PER-NODE webserver state
let echoRunning = false, echoNode = null;
let emailInboxes = {}; // nodeId -> [{from,subj,body,time}]
let routingTables = {};
let appWindowNode = null;

let ipCounters = { pc: 10, laptop: 20, router: 1, switch: 0, hub: 0, ap: 50, server: 100, modem: 0 };

const TYPES = {
  pc: { prefix: 'PC', ip: '192.168.1.', mask: '255.255.255.0', gw: '192.168.1.1', color: '#4285f4', bgColor: '#e8f0fe', hasIP: true, terminal: true, defaultApps: ['webbrowser'] },
  laptop: { prefix: 'Laptop', ip: '192.168.1.', mask: '255.255.255.0', gw: '192.168.1.1', color: '#4285f4', bgColor: '#e8f0fe', hasIP: true, terminal: true, defaultApps: ['webbrowser'] },
  router: { prefix: 'Router', ip: '192.168.1.', mask: '255.255.255.0', gw: '', color: '#e65100', bgColor: '#fff3e0', hasIP: true, terminal: false },
  switch: { prefix: 'Switch', ip: '', mask: '', gw: '', color: '#607d8b', bgColor: '#f1f3f4', hasIP: false, terminal: false },
  hub:    { prefix: 'Hub',    ip: '', mask: '', gw: '', color: '#e91e63', bgColor: '#fce4ec', hasIP: false, terminal: false },
  ap:     { prefix: 'AP',     ip: '192.168.1.', mask: '255.255.255.0', gw: '', color: '#00897b', bgColor: '#e0f2f1', hasIP: true, terminal: false },
  server: { prefix: 'Server', ip: '192.168.1.', mask: '255.255.255.0', gw: '192.168.1.1', color: '#455a64', bgColor: '#f1f3f4', hasIP: true, terminal: true },
  modem:  { prefix: 'Modem',  ip: '10.0.0.', mask: '255.255.255.0', gw: '', color: '#1565c0', bgColor: '#e3f2fd', hasIP: true, terminal: false },
};

// Available apps per device type
const APPS = {
  pc:     ['webbrowser', 'email', 'firewall'],
  laptop: ['webbrowser', 'email', 'firewall'],
  server: ['webserver', 'dnsserver', 'dhcpserver', 'emailserver', 'firewall'],
  router: ['routing', 'firewall'],
  switch: [],
  hub: [],
  ap: [],
  modem: [],
};

const APP_META = {
  webbrowser:  { name: 'Webbrowser',      icon: '🌐', desc: 'HTTP-Seiten aufrufen' },
  email:       { name: 'E-Mail',           icon: '✉',  desc: 'E-Mails senden & empfangen' },
  firewall:    { name: 'Firewall',         icon: '🛡',  desc: 'Eingehenden Traffic filtern' },
  webserver:   { name: 'Webserver',        icon: '🖥',  desc: 'HTTP-Server betreiben' },
  dnsserver:   { name: 'DNS-Server',       icon: '🔖', desc: 'Hostnamen auflösen' },
  dhcpserver:  { name: 'DHCP-Server',      icon: '⚡', desc: 'IPs automatisch vergeben' },
  emailserver: { name: 'E-Mail-Server',    icon: '📮', desc: 'SMTP/POP3-Server' },
  routing:     { name: 'Routing-Tabelle',  icon: '🗺', desc: 'Statische Routen' },
};

// ════════════════════════════════════════════════════════════
// CANVAS
// ════════════════════════════════════════════════════════════
function applyZoom() {
  const area = document.getElementById('canvas-area');
  const zp = document.getElementById('zoom-pan');
  if (!zp) return;
  // zoom-pan contains both canvas and device-layer
  // set its size to match canvas-area so children are sized correctly
  const w = area.clientWidth, h = area.clientHeight;
  zp.style.width = w + 'px';
  zp.style.height = h + 'px';
  zp.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
  cvs.width = w; cvs.height = h;
}

function resize() {
  applyZoom(); draw();
}
window.addEventListener('resize', resize);
setTimeout(resize, 30);

// Convert screen coords to canvas world coords
function screenToWorld(sx, sy) {
  const area = document.getElementById('canvas-area');
  const rect = area.getBoundingClientRect();
  return {
    x: (sx - rect.left - panX) / zoom,
    y: (sy - rect.top - panY) / zoom
  };
}

function showZoomIndicator() {
  const el = document.getElementById('zoom-indicator');
  if (!el) return;
  el.textContent = Math.round(zoom * 100) + '%';
  el.classList.add('show');
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

function draw() {
  cx.clearRect(0, 0, cvs.width, cvs.height);
  cx.save();
  cx.scale(zoom, zoom);
  cx.translate(panX / zoom, panY / zoom);

  for (const c of cables) {
    const a = nodes.find(n => n.id === c.a), b = nodes.find(n => n.id === c.b);
    if (!a || !b) continue;
    const bothOn = a.on && b.on;
    const glowing = c.glow > 0;

    if (glowing) {
      cx.save();
      cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y);
      cx.strokeStyle = `rgba(37,99,235,${c.glow * 0.035})`;
      cx.lineWidth = 8 / zoom; cx.stroke(); cx.restore();
      c.glow = Math.max(0, c.glow - 0.6);
    }

    cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y);
    cx.strokeStyle = glowing ? 'rgba(37,99,235,.7)' : bothOn ? 'rgba(37,99,235,.35)' : 'rgba(150,150,150,.3)';
    cx.lineWidth = (glowing ? 2.5 : 2) / zoom;
    cx.setLineDash(bothOn ? [] : [5, 4]);
    cx.stroke(); cx.setLineDash([]);

    [a, b].forEach(n => {
      cx.beginPath(); cx.arc(n.x, n.y, 5 / zoom, 0, Math.PI * 2);
      cx.fillStyle = bothOn ? 'rgba(37,99,235,.35)' : 'rgba(150,150,150,.25)';
      cx.fill();
    });

    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const icR = 8 / zoom;
    cx.save();
    cx.fillStyle = bothOn ? '#ffffff' : '#f5f5f5';
    cx.strokeStyle = bothOn ? 'rgba(37,99,235,.55)' : 'rgba(150,150,150,.4)';
    cx.lineWidth = 1.2 / zoom;
    cx.beginPath(); cx.arc(mx, my, icR, 0, Math.PI * 2); cx.fill(); cx.stroke();
    cx.fillStyle = bothOn ? 'rgba(37,99,235,.7)' : 'rgba(130,130,130,.5)';
    const s = 1 / zoom;
    cx.fillRect(mx - 3 * s, my - 2.5 * s, 6 * s, 4 * s);
    cx.fillStyle = bothOn ? 'rgba(37,99,235,.5)' : 'rgba(130,130,130,.35)';
    cx.fillRect(mx - 2 * s, my + 1.5 * s, 1.2 * s, 1.5 * s);
    cx.fillRect(mx - 0.5 * s, my + 1.5 * s, 1.2 * s, 1.5 * s);
    cx.fillRect(mx + 1 * s, my + 1.5 * s, 1.2 * s, 1.5 * s);
    cx.restore();
  }
  // Draw WiFi signal circles for Access Points
  for (const n of nodes) {
    if (n.type === 'ap' && n.on) {
      cx.save();
      const pulseScale = 1 + 0.03 * Math.sin(Date.now() / 600);
      for (let r = 35; r <= 90; r += 28) {
        cx.beginPath();
        cx.arc(n.x, n.y, r * pulseScale / zoom, 0, Math.PI * 2);
        cx.strokeStyle = `rgba(0,137,123,${0.12 - r * 0.001})`;
        cx.lineWidth = 1.2 / zoom;
        cx.setLineDash([4, 4]);
        cx.stroke();
        cx.setLineDash([]);
      }
      cx.restore();
    }
  }
  cx.restore();
}
// ════════════════════════════════════════════════════════════
let palType = null;
function palDrag(e, type) { palType = type; e.dataTransfer.effectAllowed = 'copy'; }

function canvasDrop(e) {
  e.preventDefault();
  if (!palType) return;
  const w = screenToWorld(e.clientX, e.clientY);
  addNode(palType, w.x, w.y);
  palType = null;
}

// ── Robuste JS-Drag-Handler (Capture-Phase, funktioniert auch wenn Kind-Elemente das Event abfangen) ──
(function initDragDrop() {
  const area = document.getElementById('canvas-area');

  area.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, true); // capture = true → fängt Event VOR Kind-Elementen ab

  area.addEventListener('drop', e => {
    e.preventDefault();
    if (!palType) return;
    const w = screenToWorld(e.clientX, e.clientY);
    addNode(palType, w.x, w.y);
    palType = null;
  }, true);

  // ── Touch-Support für Mobile ──
  let touchDragType = null, touchGhost = null;

  function initTouchDrag() {
    document.querySelectorAll('.pal-item[data-type]').forEach(item => {
      item.addEventListener('touchstart', e => {
        touchDragType = item.dataset.type;
        const t = e.touches[0];
        touchGhost = item.cloneNode(true);
        touchGhost.style.cssText = [
          'position:fixed', 'z-index:9999', 'pointer-events:none',
          'opacity:0.8', 'transform:scale(0.9) translate(-50%,-50%)',
          'transition:none', 'left:' + t.clientX + 'px', 'top:' + t.clientY + 'px'
        ].join(';');
        document.body.appendChild(touchGhost);
        e.preventDefault();
      }, { passive: false });

      item.addEventListener('touchmove', e => {
        if (!touchGhost) return;
        const t = e.touches[0];
        touchGhost.style.left = t.clientX + 'px';
        touchGhost.style.top  = t.clientY + 'px';
        e.preventDefault();
      }, { passive: false });

      item.addEventListener('touchend', e => {
        if (touchGhost) { touchGhost.remove(); touchGhost = null; }
        if (!touchDragType) return;
        const t = e.changedTouches[0];
        const rect = area.getBoundingClientRect();
        if (t.clientX >= rect.left && t.clientX <= rect.right &&
            t.clientY >= rect.top  && t.clientY <= rect.bottom) {
          const w = screenToWorld(t.clientX, t.clientY);
          addNode(touchDragType, w.x, w.y);
        }
        touchDragType = null;
        e.preventDefault();
      }, { passive: false });
    });
  }

  // DOM ist beim Script-Load schon bereit
  initTouchDrag();
})();

// ════════════════════════════════════════════════════════════
// NODE MANAGEMENT
// ════════════════════════════════════════════════════════════
function addNode(type, x, y) {
  document.getElementById('empty-state').style.display = 'none';
  const t = TYPES[type];
  ipCounters[type]++;
  const n = {
    id: nextId++, type, x, y,
    name: `${t.prefix}-${nodes.filter(d => d.type === type).length + 1}`,
    ip: '',   // Schüler müssen IP selbst eintragen!
    mask: t.hasIP ? '255.255.255.0' : '',
    gw: '', dns: '',
    mac: genMAC(), on: true,
    dhcpEnabled: false,
    autoroute: type === 'router',
    installedApps: (NODE_DEFS[type]?.defaultApps || []).slice(),
    routingTable: [],
  };
  nodes.push(n);
  n.el = buildNodeEl(n);
  updateSB(); log(`${n.name} hinzugefügt${n.ip ? ' (' + n.ip + ')' : ''}`, 'ok');
  return n;
}

function buildNodeEl(n) {
  const el = document.createElement('div');
  el.className = 'dnode' + (n.on ? '' : ' off');
  el.dataset.type = n.type;
  el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
  el.innerHTML = `
    <div class="dn-body" style="border-color:${TYPES[n.type].color}50;background:${TYPES[n.type].bgColor}">
      ${getIcon(n.type)}
      <div class="dn-status ${n.on ? 'on' : 'off'}"></div>
    </div>
    <div class="dn-name">${n.name}</div>
    <div class="dn-ip">${n.ip}</div>`;
  el.onmousedown = e => nodeDown(e, n);
  el.oncontextmenu = e => { e.preventDefault(); showCtx(e, n); };
  dLayer.appendChild(el);
  return el;
}

function getIcon(type) {
  // Design D style: flat, clean, realistic device colors — exactly like the Canva Design D icons
  const icons = {

    // ── PC ──────────────────────────────────────────────────────
    pc: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="36" height="25" rx="3" fill="#4285f4"/>
      <rect x="6" y="6" width="32" height="21" rx="2" fill="#d2e3fc"/>
      <rect x="8" y="8" width="13" height="9" rx="1" fill="rgba(255,255,255,.45)"/>
      <rect x="17" y="29" width="10" height="4" fill="#4285f4"/>
      <rect x="12" y="33" width="20" height="3" rx="1.5" fill="#3367d6"/>
    </svg>`,

    // ── Laptop ───────────────────────────────────────────────────
    laptop: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="4" width="34" height="24" rx="2.5" fill="#4285f4"/>
      <rect x="7" y="6" width="30" height="20" rx="1.5" fill="#d2e3fc"/>
      <rect x="9" y="8" width="12" height="8" rx="1" fill="rgba(255,255,255,.45)"/>
      <path d="M2 28 L42 28 L40 35 L4 35 Z" fill="#3367d6"/>
      <rect x="16" y="29.5" width="12" height="3" rx="1.5" fill="#2a56c6"/>
    </svg>`,

    // ── Router ───────────────────────────────────────────────────
    router: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="2" width="2.5" height="11" rx="1.25" fill="#e65100"/>
      <rect x="13" y="3" width="2" height="9" rx="1" fill="#e65100" transform="rotate(-12,14,7)"/>
      <rect x="29" y="3" width="2" height="9" rx="1" fill="#e65100" transform="rotate(12,30,7)"/>
      <rect x="3" y="14" width="38" height="20" rx="4" fill="#fb8c00"/>
      <rect x="3" y="14" width="38" height="10" rx="4" fill="#e65100"/>
      <rect x="3" y="20" width="38" height="14" fill="#fb8c00"/>
      <rect x="7" y="16" width="6" height="4" rx="1" fill="#bf360c"/>
      <rect x="15" y="16" width="6" height="4" rx="1" fill="#bf360c"/>
      <rect x="23" y="16" width="6" height="4" rx="1" fill="#bf360c"/>
      <circle cx="9" cy="28" r="2" fill="#4caf50"/>
      <circle cx="16" cy="28" r="2" fill="#4caf50"/>
      <circle cx="23" cy="28" r="2" fill="#4caf50"/>
      <circle cx="35" cy="28" r="2.5" fill="#ff5252"/>
    </svg>`,

    // ── Switch ───────────────────────────────────────────────────
    switch: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="12" width="40" height="20" rx="3" fill="#607d8b"/>
      <rect x="2" y="12" width="40" height="10" rx="3" fill="#78909c"/>
      <rect x="4" y="14" width="36" height="6" rx="1.5" fill="#90a4ae"/>
      <circle cx="8" cy="17" r="2" fill="#00acc1"/>
      <circle cx="13" cy="17" r="2" fill="#00acc1"/>
      <circle cx="8" cy="26" r="1.5" fill="#37474f"/>
      <circle cx="13" cy="26" r="1.5" fill="#37474f"/>
      <circle cx="18" cy="26" r="1.5" fill="#37474f"/>
      <circle cx="23" cy="26" r="1.5" fill="#37474f"/>
      <circle cx="28" cy="26" r="1.5" fill="#37474f"/>
      <circle cx="33" cy="26" r="1.5" fill="#37474f"/>
      <circle cx="37" cy="17" r="2" fill="#4caf50"/>
      <circle cx="37" cy="26" r="2" fill="#ff5252"/>
    </svg>`,

    // ── Server ───────────────────────────────────────────────────
    server: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect x="12" y="3" width="20" height="38" rx="3" fill="#455a64"/>
      <rect x="14" y="5" width="16" height="34" rx="2" fill="#37474f"/>
      <rect x="16" y="8" width="10" height="2" rx="1" fill="#546e7a"/>
      <rect x="16" y="12" width="10" height="2" rx="1" fill="#546e7a"/>
      <rect x="16" y="16" width="10" height="2" rx="1" fill="#546e7a"/>
      <rect x="16" y="21" width="10" height="3" rx="1" fill="#546e7a"/>
      <circle cx="22" cy="31" r="3.5" fill="#546e7a"/>
      <circle cx="16.5" cy="35" r="1.5" fill="#ffd600"/>
      <circle cx="22" cy="35" r="1.5" fill="#4caf50"/>
      <circle cx="27.5" cy="35" r="1.5" fill="#ff5252"/>
    </svg>`,

    // ── Hub ─────────────────────────────────────────────────────
    hub: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="13" width="40" height="20" rx="3" fill="#e91e63"/>
      <rect x="2" y="13" width="40" height="10" rx="3" fill="#f06292"/>
      <rect x="4" y="15" width="36" height="6" rx="1.5" fill="#f8bbd9"/>
      <circle cx="9" cy="27" r="2" fill="#880e4f"/>
      <circle cx="15" cy="27" r="2" fill="#880e4f"/>
      <circle cx="21" cy="27" r="2" fill="#880e4f"/>
      <circle cx="27" cy="27" r="2" fill="#880e4f"/>
      <circle cx="33" cy="27" r="2" fill="#880e4f"/>
      <circle cx="39" cy="27" r="2" fill="#880e4f"/>
      <text x="22" y="21" text-anchor="middle" font-size="6" fill="#fff" font-family="Arial" font-weight="bold">HUB</text>
    </svg>`,

    // ── WLAN Access Point ────────────────────────────────────────
    ap: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="26" width="36" height="13" rx="3" fill="#00897b"/>
      <rect x="4" y="26" width="36" height="7" rx="3" fill="#26a69a"/>
      <circle cx="11" cy="34" r="2" fill="#004d40"/>
      <circle cx="19" cy="34" r="2" fill="#4caf50"/>
      <circle cx="27" cy="34" r="2" fill="#4caf50"/>
      <circle cx="35" cy="34" r="2" fill="#4caf50"/>
      <line x1="22" y1="24" x2="22" y2="18" stroke="#00897b" stroke-width="2.5"/>
      <path d="M14 20 Q22 13 30 20" stroke="#00897b" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M10 16 Q22 7 34 16" stroke="#26a69a" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>
      <path d="M7 12 Q22 1 37 12" stroke="#4db6ac" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".4"/>
      <circle cx="22" cy="18" r="2.5" fill="#00897b"/>
    </svg>`,

    // ── Modem — DSL/Kabel-Modem (flache Box, blaue LEDs, Kabelanschluss unten) ──
    modem: `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <!-- Gehäuse: flache liegende Box -->
      <rect x="3" y="15" width="38" height="18" rx="3" fill="#1565c0"/>
      <rect x="3" y="15" width="38" height="9" rx="3" fill="#1976d2"/>
      <rect x="3" y="21" width="38" height="12" fill="#1976d2"/>
      <!-- Vorderpanel Linie -->
      <rect x="5" y="17" width="34" height="1.5" rx=".75" fill="rgba(255,255,255,.2)"/>
      <!-- LEDs Reihe -->
      <circle cx="10" cy="30" r="2.2" fill="#00e5ff"/>
      <circle cx="10" cy="30" r="1" fill="#b2ebf2" opacity=".7"/>
      <circle cx="17" cy="30" r="2.2" fill="#00e5ff"/>
      <circle cx="17" cy="30" r="1" fill="#b2ebf2" opacity=".7"/>
      <circle cx="24" cy="30" r="2.2" fill="#4caf50"/>
      <circle cx="24" cy="30" r="1" fill="#c8e6c9" opacity=".7"/>
      <circle cx="31" cy="30" r="2.2" fill="#ffd600"/>
      <circle cx="31" cy="30" r="1" fill="#fff9c4" opacity=".7"/>
      <!-- Beschriftung-Striche (stilisiert) -->
      <rect x="8" y="19" width="12" height="1.5" rx=".75" fill="rgba(255,255,255,.3)"/>
      <rect x="8" y="21.5" width="8" height="1" rx=".5" fill="rgba(255,255,255,.18)"/>
      <!-- Kabelanschlüsse unten -->
      <rect x="14" y="33" width="4" height="5" rx="1" fill="#0d47a1"/>
      <rect x="22" y="33" width="4" height="5" rx="1" fill="#0d47a1"/>
      <rect x="15" y="34.5" width="2" height="2" rx=".5" fill="#42a5f5" opacity=".8"/>
      <rect x="23" y="34.5" width="2" height="2" rx=".5" fill="#42a5f5" opacity=".8"/>
      <!-- Kleines DSL-Signal-Symbol oben rechts -->
      <path d="M33 10 Q36 7 39 10" stroke="#1976d2" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="M31 12 Q36 6 41 12" stroke="#1565c0" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".5"/>
      <circle cx="36" cy="13" r="1.5" fill="#1976d2"/>
    </svg>`,
  };
  return (icons[type] || icons.pc).replace(/\n\s*/g, ' ');
}

function refreshNode(n) {
  if (!n.el) return;
  n.el.querySelector('.dn-name').textContent = n.name;
  n.el.querySelector('.dn-ip').textContent = n.ip;
  n.el.className = 'dnode' + (selNode === n ? ' selected' : '') + (n.on ? '' : ' off');
  const dot = n.el.querySelector('.dn-status');
  dot.className = 'dn-status ' + (n.on ? 'on' : 'off');
  n.el.style.left = n.x + 'px'; n.el.style.top = n.y + 'px';
}

// ════════════════════════════════════════════════════════════
// MOUSE INTERACTIONS
// ════════════════════════════════════════════════════════════
function nodeDown(e, n) {
  e.stopPropagation(); hideCtx();
  if (e.detail === 2 && mode === 'sim') { openDesktop(n); return; }
  if (e.detail === 2 && mode === 'design') {
    const name = prompt('Gerätename:', n.name);
    if (name) { n.name = name; refreshNode(n); if (selNode === n) showCfg(n); }
    return;
  }
  if (deleteMode) { removeNode(n); return; }
  if (cableMode) {
    if (!cableFirst) { cableFirst = n; n.el.classList.add('connecting'); log(`Kabel von ${n.name} — Ziel wählen...`, 'info'); }
    else if (cableFirst !== n) { addCable(cableFirst, n); cableFirst.el.classList.remove('connecting'); cableFirst = null; }
    return;
  }
  select(n);
  dragNode = n;
  const area = document.getElementById('canvas-area');
  const rect = area.getBoundingClientRect();
  // dragOff in world-space
  dragOff.x = (e.clientX - rect.left - panX) / zoom - n.x;
  dragOff.y = (e.clientY - rect.top - panY) / zoom - n.y;
}

function cvMouseDown(e) {
  if (e.button === 1) { // Middle mouse = pan
    isPanning = true; panStart = { x: e.clientX - panX, y: e.clientY - panY };
    e.preventDefault(); return;
  }
  if ((e.target.closest('#zoom-pan') || e.target.id === 'cvs' || e.target.id === 'canvas-area') && !e.target.closest('.dnode') && !e.target.closest('.doc-note') && !e.target.closest('.doc-note-del')) {
    select(null); hideCtx();
    if (mode === 'dok') {
      const w = screenToWorld(e.clientX, e.clientY);
      addNote(w.x, w.y);
      return;
    }
    if (e.button === 0) {
      isPanning = true;
      panStart = { x: e.clientX - panX, y: e.clientY - panY };
    }
  }
  if (cableMode && cableFirst) { cableFirst.el.classList.remove('connecting'); cableFirst = null; }
}

function cvMouseMove(e) {
  if (isPanning) {
    panX = e.clientX - panStart.x; panY = e.clientY - panStart.y;
    applyZoom(); draw(); return;
  }
  if (!dragNode) return;
  const area = document.getElementById('canvas-area');
  const rect = area.getBoundingClientRect();
  const wx = (e.clientX - rect.left - panX) / zoom - dragOff.x;
  const wy = (e.clientY - rect.top - panY) / zoom - dragOff.y;
  dragNode.x = Math.max(40, Math.min(area.clientWidth / zoom - 40, wx));
  dragNode.y = Math.max(40, Math.min(area.clientHeight / zoom - 40, wy));
  dragNode.el.style.left = dragNode.x + 'px'; dragNode.el.style.top = dragNode.y + 'px'; draw();
}

function cvMouseUp(e) { dragNode = null; if (e.button === 1 || e.button === 0) isPanning = false; }

function cvDblClick(e) {
  if (mode === 'dok' && !e.target.closest('.dnode')) {
    const rect = document.getElementById('canvas-area').getBoundingClientRect();
    addNote(e.clientX - rect.left, e.clientY - rect.top);
  }
}

function cvContextMenu(e) {
  if (mode !== 'design' || e.target.closest('.dnode')) return;
  const w = screenToWorld(e.clientX, e.clientY);

  // finde angeklicktes Kabel (Abstand Linie zu Punkt)
  const clicked = cables.find(c => {
    const a = nodes.find(n => n.id === c.a), b = nodes.find(n => n.id === c.b);
    if (!a || !b) return false;
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return false;
    let t = ((w.x - a.x) * (b.x - a.x) + (w.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const dist = Math.hypot(w.x - (a.x + t * (b.x - a.x)), w.y - (a.y + t * (b.y - a.y)));
    return dist < 15 / zoom; // Großzügige 15px Klick-Toleranz
  });

  if (clicked) {
    if (confirm('🔌 Möchtest du dieses Kabel trennen?')) {
      const a = nodes.find(n => n.id === clicked.a), b = nodes.find(n => n.id === clicked.b);
      cables = cables.filter(x => x !== clicked);
      draw(); updateSB();
      log(`Kabel zwischen ${a?.name || '?'} und ${b?.name || '?'} getrennt`, 'info');
      notify('Kabel erfolgreich getrennt', 'ok');
    }
  }
}

// ════════════════════════════════════════════════════════════
// SELECTION & CONFIG
// ════════════════════════════════════════════════════════════
function select(n) {
  if (selNode) selNode.el?.classList.remove('selected');
  selNode = n;
  const win = document.getElementById('cfg-window');
  if (n) {
    n.el.classList.add('selected');
    showCfg(n);
    win.classList.add('open');
    document.getElementById('sb-sel').style.display = 'flex';
    document.getElementById('sb-selname').textContent = n.name;
  } else {
    win.classList.remove('open');
    document.getElementById('sb-sel').style.display = 'none';
  }
}

function showCfg(n) {
  document.getElementById('cfw-name').textContent = n.name;
  const typeLabels = { pc: 'PC', laptop: 'Laptop', router: 'Router', switch: 'Switch', hub: 'Hub', ap: 'WLAN-AP', server: 'Server', modem: 'Modem' };
  document.getElementById('cfw-type').textContent = typeLabels[n.type] || n.type;
  document.getElementById('cfg-name').value = n.name;
  document.getElementById('cfg-mac').value = n.mac;
  document.getElementById('cfg-ip').value = n.ip;
  document.getElementById('cfg-mask').value = n.mask;
  document.getElementById('cfg-gw').value = n.gw || '';
  document.getElementById('cfg-dns').value = n.dns || '';
  document.getElementById('cfg-dhcp').checked = n.dhcpEnabled || false;
  const hasIP = TYPES[n.type].hasIP;
  document.getElementById('cfg-net-section').style.display = hasIP ? 'block' : 'none';
  document.getElementById('cfg-gw-field').style.display = (hasIP && n.type !== 'router') ? 'block' : 'none';
  document.getElementById('cfg-dns-field').style.display = (hasIP && n.type !== 'router') ? 'block' : 'none';
  document.getElementById('cfg-dhcp-check').style.display = (hasIP && n.type !== 'router') ? 'flex' : 'none';
  document.getElementById('cfg-routing-section').style.display = (n.type === 'router') ? 'block' : 'none';
  if (n.type === 'router') document.getElementById('cfg-autoroute').checked = n.autoroute;
  document.getElementById('pwr-label').textContent = n.on ? 'Ausschalten' : 'Einschalten';
  // Router ports
  const hasPorts = n.type === 'router';
  document.getElementById('cfg-ports-section').style.display = hasPorts ? 'block' : 'none';
  if (hasPorts) {
    const nbs = neighbors(n);
    document.getElementById('cfg-ports-list').innerHTML = nbs.length ?
      nbs.map((x, i) => `<div style="padding:3px 0;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--dim)">eth${i}: ${x.name} (${x.ip || '—'})</div>`).join('') :
      '<span style="color:var(--muted)">Keine Verbindungen</span>';
  }
  // Apps tab
  renderApps(n);
}

function hideCfgWindow() {
  document.getElementById('cfg-window').classList.remove('open');
  select(null);
}

function hideCfg() {
  // legacy - nothing needed now
}

function sameSubnet(ip1, ip2, mask) {
  try {
    const toNum = s => s.split('.').reduce((a, b) => (a << 8) | parseInt(b), 0) >>> 0;
    const m = toNum(mask || '255.255.255.0');
    return (toNum(ip1) & m) === (toNum(ip2) & m);
  } catch (e) { return true; }
}

function cfgUpdate(f, v) {
  if (!selNode) return;
  selNode[f] = v;
  // IP-Konflikt prüfen
  if (f === 'ip' && v && v.match(/^\d+\.\d+\.\d+\.\d+$/)) {
    const conflict = nodes.find(nd => nd.id !== selNode.id && nd.ip === v);
    if (conflict) {
      notify(`⚠ IP-Konflikt! ${v} ist bereits von "${conflict.name}" vergeben.`, 'error');
      log(`IP-Konflikt: ${selNode.name} und ${conflict.name} haben beide ${v}!`, 'error');
    }
  }
  // Gateway-Subnetz prüfen
  if ((f === 'gw' || f === 'ip') && selNode.ip && selNode.gw &&
    selNode.ip.match(/^\d+\.\d+\.\d+\.\d+$/) && selNode.gw.match(/^\d+\.\d+\.\d+\.\d+$/)) {
    if (!sameSubnet(selNode.ip, selNode.gw, selNode.mask)) {
      notify(`⚠ Gateway und IP sind in unterschiedlichen Subnetzen!`, 'error');
      log(`Subnetzfehler: IP ${selNode.ip} und Gateway ${selNode.gw} passen nicht zusammen.`, 'error');
    }
  }
  refreshNode(selNode); showCfg(selNode);
  if (f === 'ip' || f === 'name') draw();
}

function cfgDHCP() {
  if (!selNode) return;
  selNode.dhcpEnabled = document.getElementById('cfg-dhcp').checked;
  if (selNode.dhcpEnabled && dhcpRunning && dhcpServerNode) {
    // Assign from pool
    assignDHCP(selNode);
  }
}

function switchTab(t) { switchCfwTab(t); }

function switchCfwTab(t) {
  ['cfg', 'apps', 'log'].forEach(id => {
    const tab = document.getElementById('ctab-' + id);
    const content = document.getElementById('ctab-content-' + id);
    if (tab) tab.classList.toggle('active', id === t);
    if (content) content.classList.toggle('active', id === t);
  });
}

// ════════════════════════════════════════════════════════════
// APP INSTALLATION
// ════════════════════════════════════════════════════════════
function renderApps(n) {
  const list = document.getElementById('app-list');
  const available = (APPS[n.type] || []);
  if (!available.length) { list.innerHTML = '<p style="font-size:11px;color:var(--muted);padding:12px">Keine installierbaren Apps für dieses Gerät</p>'; return; }
  list.innerHTML = '';
  available.forEach(appId => {
    const meta = APP_META[appId];
    if (!meta) return;
    const installed = n.installedApps.includes(appId);
    const el = document.createElement('div');
    el.className = 'app-item' + (installed ? ' installed' : '');
    el.innerHTML = `
      <div class="app-icon" style="background:${installed ? '#dcfce7' : '#f1f5f9'}">${meta.icon}</div>
      <div class="app-info">
        <div class="app-name">${meta.name}</div>
        <div class="app-desc">${meta.desc}</div>
      </div>
      <span class="app-badge ${installed ? 'inst' : 'avail'}">${installed ? 'Inst.' : '+'}</span>`;
    el.onclick = () => toggleApp(n, appId);
    list.appendChild(el);
  });
}

function toggleApp(n, appId) {
  if (!n.installedApps.includes(appId)) {
    n.installedApps.push(appId);
    log(`${n.name}: ${APP_META[appId].name} installiert`, 'success');
    notify(`${APP_META[appId].icon} ${APP_META[appId].name} installiert auf ${n.name}`, 'success');
  } else {
    n.installedApps = n.installedApps.filter(a => a !== appId);
    log(`${n.name}: ${APP_META[appId].name} deinstalliert`, 'warn');
  }
  renderApps(n);
}

// ════════════════════════════════════════════════════════════
// DESKTOP OPENER — opens the right app window
// ════════════════════════════════════════════════════════════
let desktopNode    = null;
let _dtLastNodeId  = null;  // Cache: grid nur bei Gerätewechsel neu bauen
let _dtMovedInfo   = null;  // { elements: [], originalParent: el }
let _dtBrowserState = { url: '', html: '' };
let _dtHist = [], _dtHistIdx = -1;

// ══ Desktop öffnen ══════════════════════════════════════════
function openDesktop(n) {
  if (!n.on)              { notify('Gerät ist ausgeschaltet', 'error'); return; }
  if (n.type === 'switch'){ notify(`${n.name}: Kein Desktop`, 'error'); return; }
  if (n.type === 'hub')   { notify(`${n.name}: Hub hat kein Desktop — er leitet Pakete an ALLE Ports weiter (Broadcast)`, 'warn'); return; }
  if (n.type === 'modem') { notify(`${n.name}: Kein Desktop`, 'error'); return; }
  if (n.type === 'ap')    { notify(`${n.name}: WLAN-AP hat kein Desktop — er verbindet WLAN-Clients mit dem Netz`, 'warn'); return; }

  const sameNode = (desktopNode?.id === n.id);
  desktopNode   = n;
  appWindowNode = n;
  cmdNode       = n;

  // Titelleiste aktualisieren
  document.getElementById('dt-devname').textContent   = n.name;
  document.getElementById('dt-ipbadge').textContent   = n.ip || 'Keine IP';
  document.getElementById('dt-typebadge').textContent = n.type.toUpperCase();
  document.getElementById('dt-prompt').textContent    = n.name + '>';
  const led = document.getElementById('dt-powerled');
  led.className = 'dt-powerled' + (n.on ? ' on' : '');

  // Grid nur neu aufbauen wenn anderes Gerät geöffnet wird
  if (!sameNode) {
    _dtLastNodeId = n.id;
    _dtBrowserState = { url: '', html: '' }; // Browser-State bei neuem Gerät resetten

    const grid   = document.getElementById('dt-apps-grid');
    const noApps = document.getElementById('dt-no-apps');
    grid.innerHTML = '';
    grid.style.display = 'grid';
    noApps.style.display = 'none';

    const inst = n.installedApps || [];
    inst.forEach(appId => {
      const meta = APP_META[appId]; if (!meta) return;
      const d = document.createElement('div');
      d.className = 'dt-app-btn'; d.dataset.app = appId;
      d.innerHTML = `<span class="dt-app-em">${meta.icon}</span><span class="dt-app-nm">${meta.name}</span>`;
      d.onclick = () => _dtOpenApp(appId);
      grid.appendChild(d);
    });
  }

  // Terminal zurücksetzen & anzeigen (nur bei neuem Gerät vollständig neu)
  _dtShowTerminal();
  if (!sameNode) {
    const out = document.getElementById('dt-output');
    out.innerHTML = '';
    _dtHist = []; _dtHistIdx = -1;
    const inst = n.installedApps || [];
    _dtPrint(`NetSim Terminal — ${n.name}`, 'info');
    _dtPrint(`Typ: ${n.type.toUpperCase()}   MAC: ${n.mac}`, 'sys');
    _dtPrint(`IP: ${n.ip||'(nicht gesetzt)'}   Maske: ${n.mask||'—'}   GW: ${n.gw||'—'}`, 'sys');
    if (inst.length) _dtPrint(`Apps: ${inst.map(a=>APP_META[a]?.name).filter(Boolean).join(', ')}`, 'sys');
    _dtPrint('', 'sys');
    _dtPrint("Tippe 'help' für alle Befehle.", 'sys');
    _dtPrint('', 'sys');
  }

  const overlay = document.getElementById('dt-overlay');
  overlay.style.display = 'flex';
  requestAnimationFrame(() => {
    const inp = document.getElementById('dt-input');
    if (inp) inp.focus();
  });
}

// ══ App inline im Desktop öffnen ════════════════════════════
const _dtWinMap = {
  webserver:'win-webserver', dnsserver:'win-dns',  dhcpserver:'win-dhcp',
  email:'win-email', routing:'win-routing', firewall:'win-firewall',
};

function _dtOpenApp(appId) {
  const n = desktopNode; if (!n) return;
  appWindowNode = n;

  // Vorherige DOM-Moves sicher zurückgeben
  if (_dtMovedInfo) {
    const { elements, originalParent } = _dtMovedInfo;
    if (originalParent && elements) {
      elements.forEach(el => { if (el && originalParent) originalParent.appendChild(el); });
    }
    _dtMovedInfo = null;
  }

  // App-Daten initialisieren
  if (appId==='dnsserver')  initDNSWindow();
  if (appId==='dhcpserver') initDHCPWindow();
  if (appId==='webserver')  initWebserverWindow();
  if (appId==='routing')    initRoutingWindow();
  if (appId==='firewall')   initFirewallWindow();

  const meta  = APP_META[appId];
  const panel = document.getElementById('dt-app-panel');
  panel.innerHTML = '';

  // ── Webbrowser: direkt rendern (kein DOM-Move) ──
  if (appId === 'webbrowser') {
    const savedUrl  = _dtBrowserState.url  || '';
    const savedHtml = _dtBrowserState.html || `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;color:#94a3b8">
        <div style="font-size:42px">🌐</div>
        <div style="font-size:13px">IP-Adresse oder Hostname eingeben und Enter drücken</div>
      </div>`;
    panel.innerHTML = `
      <div style="display:flex;gap:8px;padding:10px 14px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0;align-items:center">
        <input id="dt-browser-url" placeholder="http://192.168.1.1 oder Hostname"
          value="${savedUrl.replace(/"/g,'&quot;')}"
          style="flex:1;background:var(--surface);border:1.5px solid var(--border);border-radius:7px;padding:7px 12px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text);outline:none;transition:border-color .15s"
          onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"
          onkeydown="if(event.key==='Enter')dtBrowserGo()" />
        <button onclick="dtBrowserGo()"
          style="background:var(--accent);color:#fff;border:none;border-radius:7px;padding:7px 16px;font-weight:700;cursor:pointer;font-family:'Nunito',sans-serif;font-size:13px;white-space:nowrap;transition:opacity .15s"
          onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">Öffnen</button>
      </div>
      <div id="dt-browser-view" style="flex:1;overflow-y:auto;background:#fff;min-height:0">${savedHtml}</div>`;
    _dtMovedInfo = null;

  // ── Apps ohne eigenes Fenster → Info-Karte ──
  } else if (!_dtWinMap[appId]) {
    panel.innerHTML = `
      <div style="padding:28px 24px;color:var(--text);font-family:'Nunito',sans-serif">
        <div style="font-size:28px;margin-bottom:12px">${meta?.icon||'📦'}</div>
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">${meta?.name||appId}</div>
        <div style="font-size:13px;color:var(--dim);margin-bottom:16px">${meta?.desc||''}</div>
        <div style="font-size:12px;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px">
          ✓ Dienst läuft automatisch im Hintergrund.
        </div>
      </div>`;
    _dtMovedInfo = null;

  // ── Alle anderen Apps: DOM-Move ──
  } else {
    const winEl = document.getElementById(_dtWinMap[appId]);
    const body  = winEl?.querySelector('.aw-body');
    if (body) {
      panel.appendChild(body);
      _dtMovedInfo = { elements: [body], originalParent: winEl };
    } else {
      panel.innerHTML = `
        <div style="padding:28px 24px;color:var(--text);font-family:'Nunito',sans-serif">
          <div style="font-size:28px;margin-bottom:12px">${meta?.icon||'📦'}</div>
          <div style="font-size:16px;font-weight:800">${meta?.name||appId}</div>
          <div style="margin-top:8px;font-size:12px;color:var(--muted)">App konnte nicht geladen werden.</div>
        </div>`;
      _dtMovedInfo = null;
    }
  }

  // Header & Buttons
  document.querySelectorAll('.dt-app-btn').forEach(b => b.classList.toggle('active', b.dataset.app===appId));
  document.getElementById('dt-right-label').textContent = (meta?.icon||'') + '  ' + (meta?.name||appId);
  document.getElementById('dt-back-btn').style.display  = 'flex';
  document.getElementById('dt-cls-btn').style.display   = 'none';
  _dtSwitchView('panel');
}

// ══ Zurück zum Terminal ══════════════════════════════════════
function dtBack() {
  if (_dtMovedInfo) {
    const { elements, originalParent } = _dtMovedInfo;
    if (originalParent && elements) {
      elements.forEach(el => { if (el && originalParent) originalParent.appendChild(el); });
    }
    _dtMovedInfo = null;
  }
  const panel = document.getElementById('dt-app-panel');
  if (panel) { panel.innerHTML = ''; panel.style.display = 'none'; }
  _dtShowTerminal();
}

function _dtSwitchView(to) {
  const term  = document.getElementById('dt-term');
  const panel = document.getElementById('dt-app-panel');
  if (to === 'panel') {
    term.style.display  = 'none';
    panel.style.display = 'flex';
    panel.style.opacity = '0'; panel.style.transform = 'translateX(8px)';
    requestAnimationFrame(() => {
      panel.style.transition = 'opacity .16s ease, transform .16s ease';
      panel.style.opacity = '1'; panel.style.transform = 'translateX(0)';
    });
  } else {
    panel.style.display = 'none';
    term.style.display  = 'flex';
    term.style.opacity  = '0'; term.style.transform = 'translateX(-8px)';
    requestAnimationFrame(() => {
      term.style.transition = 'opacity .16s ease, transform .16s ease';
      term.style.opacity = '1'; term.style.transform = 'translateX(0)';
    });
  }
}

function _dtShowTerminal() {
  document.getElementById('dt-back-btn').style.display  = 'none';
  document.getElementById('dt-cls-btn').style.display   = '';
  document.getElementById('dt-right-label').textContent = 'Terminal';
  document.querySelectorAll('.dt-app-btn').forEach(b => b.classList.remove('active'));
  _dtApplyTheme();
  _dtSwitchView('term');
  setTimeout(() => { const i = document.getElementById('dt-input'); if(i) i.focus(); }, 50);
}

function _dtApplyTheme() {
  const dark   = document.body.classList.contains('dark');
  const bg     = dark ? '#0d1117'               : '#f2efe8';
  const text   = dark ? '#e6edf3'               : '#1a1a1a';
  const prompt = dark ? '#4ade80'               : '#16803c';
  const bdr    = dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.10)';
  const out    = document.getElementById('dt-output');
  const inpRow = document.getElementById('dt-input-row');
  const hints  = document.getElementById('dt-hints');
  const inp    = document.getElementById('dt-input');
  const prmpt  = document.getElementById('dt-prompt');
  if (out)    { out.style.background = bg;    out.style.color = text; }
  if (inpRow) { inpRow.style.background = bg; inpRow.style.borderTopColor = bdr; }
  if (hints)  { hints.style.background  = bg; hints.style.borderTopColor  = bdr; }
  if (inp)    { inp.style.color = text; }
  if (prmpt)  { prmpt.style.color = prompt; }
}

// ══ Desktop schließen ════════════════════════════════════════
function closeDesktop() {
  dtBack();
  document.getElementById('dt-overlay').style.display = 'none';
  desktopNode = null; cmdNode = null;
}

function openTerminalFromDesktop() { dtBack(); }

// ══ Terminal-Ausgabe ═════════════════════════════════════════
function _dtPrint(msg, type='cmd') {
  const out = document.getElementById('dt-output'); if (!out) return;
  const d = document.createElement('div');
  d.className = 'dtl ' + type; d.textContent = msg;
  out.appendChild(d); out.scrollTop = out.scrollHeight;
}

function dtClear() {
  const out = document.getElementById('dt-output'); if (out) out.innerHTML = '';
}

function dtFill(cmd) {
  const inp = document.getElementById('dt-input'); if (!inp) return;
  inp.value = cmd; inp.focus();
}

function dtKey(e) {
  const inp = document.getElementById('dt-input');
  if (e.key === 'Enter') {
    const raw = inp.value.trim(); inp.value = '';
    if (!raw || !cmdNode) return;
    _dtHist.push(raw); _dtHistIdx = -1;
    _dtPrint(cmdNode.name + '> ' + raw, 'cmd');
    window._dtActive = true; handleCmd(raw); window._dtActive = false;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (_dtHistIdx < _dtHist.length-1) { _dtHistIdx++; inp.value = _dtHist[_dtHist.length-1-_dtHistIdx]; }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (_dtHistIdx > 0) { _dtHistIdx--; inp.value = _dtHist[_dtHist.length-1-_dtHistIdx]; }
    else { _dtHistIdx=-1; inp.value=''; }
  } else if (e.key === 'Escape') { closeDesktop(); }
}

// ══ Klick außerhalb = schließen ══════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('dt-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'dt-overlay') closeDesktop();
  });
  // Fenster draggbar machen
  const win = document.getElementById('dt-win');
  const bar = document.getElementById('dt-titlebar');
  if (win && bar) {
    let dn=false,sx=0,sy=0,ox=0,oy=0;
    bar.addEventListener('mousedown', e => {
      if (e.target.classList.contains('dt-dot')) return;
      dn=true; sx=e.clientX; sy=e.clientY;
      const r=win.getBoundingClientRect(); ox=r.left; oy=r.top;
      win.style.position='fixed'; win.style.margin='0';
      win.style.left=ox+'px'; win.style.top=oy+'px';
      win.style.transform='none';
    });
    document.addEventListener('mousemove',e=>{if(!dn)return; win.style.left=(ox+e.clientX-sx)+'px'; win.style.top=(oy+e.clientY-sy)+'px';});
    document.addEventListener('mouseup',()=>dn=false);
  }
});

function openAppWindow(appId, n) {
  appWindowNode = n || selNode;

  // Wenn Desktop offen → App direkt darin zeigen
  if (document.getElementById('dt-overlay')?.style.display === 'flex') {
    if (n) desktopNode = n;
    _dtOpenApp(appId);
    return;
  }

  closeAllApps();
  const map = {
    webserver: 'win-webserver', dnsserver: 'win-dns', dhcpserver: 'win-dhcp',
    webbrowser: 'win-browser',  email: 'win-email',   routing: 'win-routing',
    firewall: 'win-firewall',
  };
  const winId = map[appId];
  if (!winId) { openCMD(appWindowNode); return; }
  if (appId === 'dnsserver') initDNSWindow();
  if (appId === 'dhcpserver') initDHCPWindow();
  if (appId === 'webserver') initWebserverWindow();
  if (appId === 'routing') initRoutingWindow();
  if (appId === 'firewall') initFirewallWindow();
  const win = document.getElementById(winId);
  if (win) { win.classList.add('open'); win.style.zIndex = 600 + nextId++; }
}

function closeAllApps() {
  document.querySelectorAll('.app-window').forEach(w => w.classList.remove('open'));
}
function closeApp(which) {
  const map = {
    browser: 'win-browser', dns: 'win-dns', dhcp: 'win-dhcp', webserver: 'win-webserver',
    email: 'win-email', echo: 'win-echo', routing: 'win-routing',
    firewall: 'win-firewall',
  };
  const el = document.getElementById(map[which]);
  if (el) el.classList.remove('open');
}

// ════════════════════════════════════════════════════════════
// FIREWALL
// ════════════════════════════════════════════════════════════
let fwRules = {}; // nodeId -> [{action, port, src}]

function initFirewallWindow() {
  const n = appWindowNode || desktopNode;
  if (!n) return;
  if (!fwRules[n.id]) fwRules[n.id] = [
    { action: 'block', port: '23',   src: '*', desc: 'Telnet blockieren' },
    { action: 'allow', port: '80',   src: '*', desc: 'HTTP erlauben' },
    { action: 'allow', port: '443',  src: '*', desc: 'HTTPS erlauben' },
  ];
  renderFwRules(n);
  const logEl = document.getElementById('fw-log');
  if (logEl) logEl.textContent = `Firewall auf ${n.name} — ${fwRules[n.id].length} Regel(n) aktiv.`;
}

function renderFwRules(n) {
  const list = document.getElementById('fw-rules-list');
  if (!list) return;
  const rules = fwRules[n.id] || [];
  if (!rules.length) { list.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:4px">Keine Regeln definiert.</div>'; return; }
  list.innerHTML = rules.map((r, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:var(--panel);border:1px solid var(--border)">
      <span style="font-size:11px;font-weight:800;padding:2px 7px;border-radius:4px;
        background:${r.action==='block'?'#fee2e2':'#dcfce7'};
        color:${r.action==='block'?'#dc2626':'#16a34a'}">${r.action==='block'?'BLOCK':'ALLOW'}</span>
      <span style="flex:1;color:var(--text)">Port <b>${r.port}</b> ${r.src!=='*'?'von '+r.src:''} ${r.desc?'<span style="color:var(--muted)">— '+r.desc+'</span>':''}</span>
      <button onclick="fwDeleteRule(${i})" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;line-height:1;padding:0 2px">×</button>
    </div>`).join('');
}

function fwAddRule() {
  const n = appWindowNode || desktopNode; if (!n) return;
  const action = document.getElementById('fw-action').value;
  const port   = document.getElementById('fw-port').value.trim() || '*';
  const src    = document.getElementById('fw-src').value.trim() || '*';
  if (!fwRules[n.id]) fwRules[n.id] = [];
  fwRules[n.id].push({ action, port, src });
  document.getElementById('fw-port').value = '';
  document.getElementById('fw-src').value  = '';
  renderFwRules(n);
  const logEl = document.getElementById('fw-log');
  if (logEl) logEl.textContent = `✓ Regel hinzugefügt: ${action.toUpperCase()} Port ${port} von ${src}`;
  log(`${n.name}: Firewall-Regel — ${action.toUpperCase()} Port ${port}`, 'info');
}

function fwDeleteRule(idx) {
  const n = appWindowNode || desktopNode; if (!n) return;
  fwRules[n.id]?.splice(idx, 1);
  renderFwRules(n);
}

function fwToggle() {
  const enabled = document.getElementById('fw-enabled').checked;
  const label   = document.getElementById('fw-status-label');
  if (label) { label.textContent = enabled ? 'Aktiv' : 'Deaktiviert'; label.style.color = enabled ? '#22c55e' : '#ef4444'; }
  const n = appWindowNode || desktopNode;
  if (n) log(`${n.name}: Firewall ${enabled?'aktiviert':'deaktiviert'}`, enabled?'success':'warn');
}


// ════════════════════════════════════════════════════════════
// CABLES
// ════════════════════════════════════════════════════════════
function addCable(a, b) {
  if (cables.find(c => (c.a === a.id && c.b === b.id) || (c.a === b.id && c.b === a.id))) {
    notify('Verbindung existiert bereits', 'error'); return;
  }
  cables.push({ id: nextId++, a: a.id, b: b.id, glow: 0 });
  log(`Verbunden: ${a.name} ↔ ${b.name}`, 'success');
  draw(); updateSB();
}

function removeNode(n) {
  cables = cables.filter(c => c.a !== n.id && c.b !== n.id);
  nodes = nodes.filter(nd => nd.id !== n.id);
  n.el?.remove();
  if (selNode === n) select(null);
  draw(); updateSB();
  log(`${n.name} entfernt`, 'warn');
  if (!nodes.length) document.getElementById('empty-state').style.display = 'block';
}

function togglePower() {
  if (!selNode) return;
  selNode.on = !selNode.on;
  refreshNode(selNode); showCfg(selNode); draw();
  log(`${selNode.name} → ${selNode.on ? 'EIN' : 'AUS'}`, selNode.on ? 'success' : 'warn');
}

function deleteSelected() { if (selNode) removeNode(selNode); }

// ════════════════════════════════════════════════════════════
// MODE MANAGEMENT
// ════════════════════════════════════════════════════════════
function setMode(m) {
  mode = m;
  ['design', 'sim'].forEach(x => {
    document.getElementById('mo-' + x)?.classList.toggle('active', m === x);
  });
  document.body.classList.toggle('sim-mode', m === 'sim');
  const modeNames = { design: '✏ Entwurfsmodus', sim: '▶ Simulationsmodus' };
  document.getElementById('sb-mode').textContent = modeNames[m];
  if (cableMode && m !== 'design') toggleCable();
  if (deleteMode && m !== 'design') toggleDelete();
  log(modeNames[m] + ' aktiviert', 'info');
}

function toggleTheme() {
  const dark = document.body.classList.toggle('dark');
  localStorage.setItem('netsim-theme', dark ? 'dark' : 'light');
  document.getElementById('theme-icon-sun').style.display  = dark ? 'none'  : '';
  document.getElementById('theme-icon-moon').style.display = dark ? ''      : 'none';
  if (typeof _dtApplyTheme === 'function') _dtApplyTheme();
}

// Restore saved theme on load
(function() {
  const saved = localStorage.getItem('netsim-theme');
  if (saved === 'dark') {
    document.body.classList.add('dark');
    const sun  = document.getElementById('theme-icon-sun');
    const moon = document.getElementById('theme-icon-moon');
    if (sun)  sun.style.display  = 'none';
    if (moon) moon.style.display = '';
  }
})();

function toggleCable() {
  if (mode !== 'design') { notify('Nur im Entwurfsmodus', 'error'); return; }
  cableMode = !cableMode;
  document.getElementById('sb-cable').classList.toggle('active', cableMode);
  document.body.classList.toggle('cable-mode', cableMode);
  if (!cableMode && cableFirst) { cableFirst.el.classList.remove('connecting'); cableFirst = null; }
  if (deleteMode && cableMode) toggleDelete();
}

function toggleDelete() {
  if (mode !== 'design') { notify('Nur im Entwurfsmodus', 'error'); return; }
  deleteMode = !deleteMode;
  document.getElementById('btn-delete').classList.toggle('active', deleteMode);
  document.getElementById('btn-delete').classList.toggle('del', deleteMode);
  document.body.classList.toggle('delete-mode', deleteMode);
  if (cableMode && deleteMode) toggleCable();
}

function toggleDocMode() {
  document.getElementById('btn-doc').classList.toggle('active');
}

function toggleCapture() {
  captureActive = !captureActive;
  if (captureActive) notify('📡 Aufzeichnung läuft', 'info');
}

// ════════════════════════════════════════════════════════════
// ROUTING — BFS
// ════════════════════════════════════════════════════════════
function neighbors(n) {
  return cables.filter(c => c.a === n.id || c.b === n.id)
    .map(c => nodes.find(nd => nd.id === (c.a === n.id ? c.b : c.a))).filter(Boolean);
}

function findPath(src, dstIP) {
  const dst = nodes.find(n => n.ip === dstIP);
  if (!dst) return null;
  if (src.id === dst.id) return [src];
  const visited = new Set([src.id]);
  const q = [[src]];
  while (q.length) {
    const path = q.shift();
    const cur = path[path.length - 1];
    for (const nb of neighbors(cur)) {
      if (!nb.on) continue;
      if (nb.id === dst.id) return [...path, nb];
      if (!visited.has(nb.id)) { visited.add(nb.id); q.push([...path, nb]); }
    }
  }
  return null;
}


// ════════════════════════════════════════════════════════════
// ZOOM & PAN
// ════════════════════════════════════════════════════════════
function cvWheel(e) {
  e.preventDefault();
  const area = document.getElementById('canvas-area');
  const rect = area.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const delta = e.deltaY > 0 ? 0.88 : 1.14;
  const newZoom = Math.max(0.25, Math.min(4.0, zoom * delta));
  // Zoom toward mouse position
  panX = mx - (mx - panX) * (newZoom / zoom);
  panY = my - (my - panY) * (newZoom / zoom);
  zoom = newZoom;
  applyZoom(); draw();
  showZoomIndicator();
}

// ════════════════════════════════════════════════════════════
// PACKET ANIMATION
// ════════════════════════════════════════════════════════════
function animatePkt(path, color, onDone) {
  if (path.length < 2) { onDone && onDone(); return; }
  for (let i = 0; i < path.length - 1; i++) {
    const c = cables.find(c => (c.a === path[i].id && c.b === path[i + 1].id) || (c.a === path[i + 1].id && c.b === path[i].id));
    if (c) c.glow = 40;
  }
  // Capture
  if (captureActive) {
    addCapture('ICMP', `${path[0].ip} → ${path[path.length - 1].ip} Echo Request`);
  }
  const area = document.getElementById('canvas-area');
  const pkt = document.createElement('div');
  pkt.className = 'packet'; pkt.style.background = color; area.appendChild(pkt);
  let seg = 0, t = 0;
  function step() {
    if (seg >= path.length - 1) { pkt.remove(); onDone && onDone(); return; }
    t += 0.035;
    if (t >= 1) { t = 0; seg++; }
    if (seg >= path.length - 1) { pkt.remove(); onDone && onDone(); return; }
    const a = path[seg], b = path[seg + 1];
    pkt.style.left = (a.x + (b.x - a.x) * t) + 'px';
    pkt.style.top = (a.y + (b.y - a.y) * t) + 'px';
    draw();
    requestAnimationFrame(step);
  }
  step();
}

// ════════════════════════════════════════════════════════════
// TERMINAL
// ════════════════════════════════════════════════════════════
function openCMD(n) {
  if (n.type === 'switch') { notify(`${n.name}: Kein Terminal verfügbar`, 'error'); return; }
  cmdNode = n;
  const overlay = document.getElementById('cmd-overlay');
  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('visible'));
  document.getElementById('cmd-name').textContent = n.name;
  document.getElementById('cmd-ip').textContent = n.ip || 'Keine IP';
  document.getElementById('cmd-prompt').textContent = n.name + '>';
  document.getElementById('cmd-output').innerHTML = '';
  cmdHistory = []; cmdHistIdx = -1;
  cPrint(`NetSim Terminal — ${n.name}`, 'info');
  cPrint(`Typ: ${n.type.toUpperCase()}  MAC: ${n.mac}`, 'sys');
  cPrint(`IP: ${n.ip || '(nicht konfiguriert)'}  Maske: ${n.mask || '—'}  GW: ${n.gw || '—'}  DNS: ${n.dns || '—'}`, 'sys');
  cPrint(`Installierte Apps: ${n.installedApps.map(a => APP_META[a]?.name).join(', ') || 'keine'}`, 'sys');
  cPrint(``, 'sys');
  cPrint(`Tippe 'help' für alle verfügbaren Befehle.`, 'sys');
  cPrint(``, 'sys');
  setTimeout(() => document.getElementById('cmd-input').focus(), 80);
}

function openTerminal() {
  if (!selNode) return;
  if (mode !== 'sim') setMode('sim');
  openDesktop(selNode);
}

function closeCMD() {
  const overlay = document.getElementById('cmd-overlay');
  overlay.classList.remove('visible');
  setTimeout(() => { overlay.style.display = 'none'; cmdNode = null; }, 200);
}

function cPrint(msg, type = 'cmd') {
  // Wenn Desktop-Terminal aktiv → dort ausgeben
  if (window._dtActive || document.getElementById('dt-overlay')?.style.display === 'flex') {
    _dtPrint(msg, type); return;
  }
  const out = document.getElementById('cmd-output');
  const d = document.createElement('div');
  d.className = 'cl ' + type; d.textContent = msg;
  out.appendChild(d); out.scrollTop = out.scrollHeight;
}

function cmdKeydown(e) {
  if (e.key === 'Enter') { execCMD(); }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cmdHistIdx < cmdHistory.length - 1) { cmdHistIdx++; document.getElementById('cmd-input').value = cmdHistory[cmdHistory.length - 1 - cmdHistIdx]; }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (cmdHistIdx > 0) { cmdHistIdx--; document.getElementById('cmd-input').value = cmdHistory[cmdHistory.length - 1 - cmdHistIdx]; }
    else { cmdHistIdx = -1; document.getElementById('cmd-input').value = ''; }
  }
}

function execCMD() {
  const inp = document.getElementById('cmd-input');
  const raw = inp.value.trim(); inp.value = '';
  if (!raw || !cmdNode) return;
  cmdHistory.push(raw); cmdHistIdx = -1;
  cPrint(`${cmdNode.name}> ${raw}`, 'cmd');
  handleCmd(raw);
}

function handleCmd(raw) {
  const parts = raw.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const n = cmdNode;

  if (cmd === 'cls' || cmd === 'clear') {
    if (document.getElementById('dt-overlay')?.style.display === 'flex') {
      const out = document.getElementById('dt-output'); if (out) out.innerHTML = '';
    } else {
      document.getElementById('cmd-output').innerHTML = '';
    }
    return;
  }

  if (cmd === 'help') {
    cPrint('', 'sys');
    cPrint('╔══════════════════════════════════════════╗', 'info');
    cPrint('║       NetSim V1.2 — Befehle              ║', 'info');
    cPrint('╚══════════════════════════════════════════╝', 'info');
    cPrint('', 'sys');
    cPrint('  Netzwerk:', 'info');
    cPrint('  ping <IP>           Gerät anpingen', 'ok');
    cPrint('  traceroute <IP>     Pakete verfolgen', 'ok');
    cPrint('  ipconfig            IP-Einstellungen anzeigen', 'ok');
    cPrint('  ifconfig            Wie ipconfig + Subnetzinfo', 'ok');
    cPrint('  arp                 ARP-Tabelle anzeigen', 'ok');
    cPrint('  netstat             Aktive Verbindungen', 'ok');
    cPrint('  route               Routing-Tabelle', 'ok');
    cPrint('  nslookup <n>     DNS-Auflösung', 'ok');
    cPrint('', 'sys');
    cPrint('  Dateisystem:', 'info');
    cPrint('  ls / dir            Dateien auflisten', 'ok');
    cPrint('  cat <Datei>         Dateiinhalt anzeigen', 'ok');
    cPrint('', 'sys');
    cPrint('  Dienste:', 'info');
    cPrint('  ssh <IP>            SSH-Verbindung', 'ok');
    cPrint('  wget <URL>          Webseite herunterladen', 'ok');
    cPrint('  whoami              Aktuelles Gerät', 'ok');
    cPrint('  hostname / cls      Name / Terminal leeren', 'ok');
    cPrint('', 'sys');
    if (n.installedApps.length) {
      cPrint('  Apps (im Desktop öffnen):', 'info');
      n.installedApps.forEach(a => cPrint(`    • ${APP_META[a]?.name} — ${APP_META[a]?.desc}`, 'sys'));
      cPrint('', 'sys');
    }
    return;
  }

  if (cmd === 'hostname') { cPrint(n.name, 'ok'); return; }

  if (cmd === 'ipconfig') {
    cPrint('', 'sys');
    cPrint(`Netzwerkeinstellungen von ${n.name}:`, 'info');
    cPrint('', 'sys');
    cPrint(`  Gerätename  : ${n.name}`, 'sys');
    cPrint(`  MAC-Adresse : ${n.mac}`, 'sys');
    cPrint('', 'sys');
    cPrint(`  IP-Adresse  : ${n.ip || '(nicht vergeben)'}`, n.ip ? 'ok' : 'warn');
    cPrint(`  Subnetzmaske: ${n.mask || '—'}`, 'sys');
    cPrint(`  Gateway     : ${n.gw || '(nicht gesetzt)'}`, n.gw ? 'sys' : 'warn');
    if (n.dns) cPrint(`  DNS-Server  : ${n.dns}`, 'sys');
    if (n.dhcpEnabled) cPrint('  DHCP        : aktiv (IP automatisch erhalten)', 'ok');
    cPrint('', 'sys');
    return;
  }
  if (cmd === 'arp') {
    cPrint('', 'sys');
    cPrint('Bekannte Geräte im Netzwerk (ARP-Tabelle):', 'info');
    cPrint('', 'sys');
    const nb = neighbors(n).filter(x => x.ip);
    if (!nb.length) cPrint('  (noch keine Geräte bekannt — erst pingen!)', 'warn');
    else {
      cPrint('  IP-Adresse         MAC-Adresse         Gerät', 'sys');
      nb.forEach(x => cPrint(`  ${x.ip.padEnd(19)}${x.mac.padEnd(20)}${x.name}`, 'ok'));
    }
    cPrint('', 'sys');
    return;
  }
  if (cmd === 'nslookup' || cmd === 'host' || cmd === 'dns') {
    const name = parts[1];
    if (!name) { cPrint('Syntax: nslookup <hostname>', 'err'); cPrint('Beispiel: nslookup www.schule.de', 'sys'); return; }
    cPrint('', 'sys');
    const lower = name.toLowerCase();
    if (dnsEntries[lower]) {
      cPrint(`✓ ${name}  →  ${dnsEntries[lower]}`, 'ok');
      cPrint('  (Eintrag aus DNS-Server)', 'sys');
    } else {
      const byNode = nodes.find(x => x.name.toLowerCase() === lower);
      if (byNode && byNode.ip) {
        cPrint(`✓ ${byNode.name}  →  ${byNode.ip}`, 'ok');
        cPrint('  (lokal aufgelöst)', 'sys');
      } else if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
        const found = nodes.find(x => x.ip === name);
        if (found) cPrint(`✓ ${name}  →  ${found.name}`, 'ok');
        else cPrint(`✗ IP ${name} keinem Gerät bekannt`, 'err');
      } else {
        cPrint(`✗ "${name}" nicht gefunden`, 'err');
        cPrint('  Tipp: DNS-Server einrichten und Eintrag hinzufügen.', 'warn');
      }
    }
    cPrint('', 'sys');
    if (captureActive) addCapture('DNS', `${n.ip} → Anfrage: ${name}`);
    return;
  }
  if (cmd === 'net' && parts[1] === 'send') {
    const targetIP = parts[2];
    const msg = parts.slice(3).join(' ');
    if (!targetIP || !msg) { cPrint('Syntax: net send <IP> <Nachricht>', 'err'); return; }
    const target = nodes.find(x => x.ip === targetIP);
    if (!target || !target.on) { cPrint('Ziel nicht erreichbar', 'err'); return; }
    const path = findPath(n, targetIP);
    if (!path) { cPrint('Kein Pfad zum Ziel', 'err'); return; }
    animatePkt(path, '#7c3aed', () => {
      if (!emailInboxes[target.id]) emailInboxes[target.id] = [];
      emailInboxes[target.id].push({ from: n.ip, subj: 'Nachricht von ' + n.name, body: msg, time: now() });
      cPrint(`Nachricht gesendet an ${target.name}`, 'ok');
      log(`Nachricht: ${n.name} → ${target.name}: "${msg}"`, 'packet');
    });
    return;
  }

  if (cmd === 'ping') {
    let count = 4, target, continuous = false;
    const ni = parts.indexOf('-n'), ti = parts.indexOf('-t');
    if (ni !== -1) { count = parseInt(parts[ni + 1]) || 4; target = parts[ni + 2] || parts.slice(-1)[0]; }
    else if (ti !== -1) { count = 20; continuous = true; target = parts[ti + 1] || parts.slice(-1)[0]; }
    else target = parts[1];
    if (!target) { cPrint('Syntax: ping [-n Anz] [-t] <IP|Name>', 'err'); return; }
    // Resolve hostname
    let ip = resolveHost(target, n);
    doPing(n, ip, count);
    return;
  }

  if (cmd === 'traceroute' || cmd === 'tracert') {
    const target = parts[1];
    if (!target) { cPrint('Syntax: tracert <IP|Name>', 'err'); return; }
    doTracert(n, resolveHost(target, n));
    return;
  }

  // ── Extended commands ──
  if (handleCmdExtended(raw, n)) return;

  cPrint(`Unbekannter Befehl: '${cmd}'`, 'err');
  cPrint("Tippe 'help' für eine Liste aller Befehle.", 'warn');
}

// ─────────────────────────────────────────────────────────────
// EXTENDED TERMINAL COMMANDS (netstat, route, ifconfig, etc.)
// ─────────────────────────────────────────────────────────────
function handleCmdExtended(raw, n) {
  const parts = raw.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === 'ifconfig' || cmd === 'ipconfig /all') {
    // Same as ipconfig but with more details
    cPrint('', 'sys');
    cPrint(`Ethernet-Adapter — ${n.name}:`, 'info');
    cPrint('', 'sys');
    cPrint(`  Gerätename    : ${n.name}`, 'sys');
    cPrint(`  Gerätetyp     : ${n.type.toUpperCase()}`, 'sys');
    cPrint(`  MAC-Adresse   : ${n.mac}`, 'sys');
    cPrint('', 'sys');
    cPrint(`  IPv4-Adresse  : ${n.ip || '(nicht konfiguriert)'}`, n.ip ? 'ok' : 'warn');
    cPrint(`  Subnetzmaske  : ${n.mask || '—'}`, 'sys');
    cPrint(`  Gateway       : ${n.gw || '(nicht gesetzt)'}`, n.gw ? 'sys' : 'warn');
    cPrint(`  DNS-Server    : ${n.dns || '(nicht gesetzt)'}`, 'sys');
    cPrint(`  DHCP          : ${n.dhcpEnabled ? 'aktiv' : 'deaktiviert'}`, 'sys');
    if (n.ip && n.mask) {
      const info = subnetInfo(n.ip, prefixFromMask(n.mask));
      if (info) {
        cPrint('', 'sys');
        cPrint(`  Netzadresse   : ${info.network}`, 'sys');
        cPrint(`  Broadcast     : ${info.broadcast}`, 'sys');
        cPrint(`  Netz (CIDR)   : ${info.cidr}`, 'sys');
      }
    }
    cPrint('', 'sys');
    return true;
  }

  if (cmd === 'whoami') {
    cPrint('', 'sys');
    cPrint(`  Benutzer: Administrator`, 'ok');
    cPrint(`  Gerät  : ${n.name} (${n.type.toUpperCase()})`, 'ok');
    cPrint(`  IP     : ${n.ip || 'keine'}`, 'sys');
    cPrint('', 'sys');
    return true;
  }

  if (cmd === 'netstat') {
    cPrint('', 'sys');
    cPrint('Aktive Verbindungen:', 'info');
    cPrint('', 'sys');
    cPrint('  Protokoll  Lokale Adresse      Remote-Adresse      Status', 'sys');
    const connected = neighbors(n).filter(x => x.ip && x.on);
    if (!connected.length) {
      cPrint('  (Keine aktiven Verbindungen)', 'warn');
    } else {
      connected.forEach(nb => {
        const proto = nb.installedApps?.includes('webserver') ? 'TCP' :
                      'ICMP';
        const port = nb.installedApps?.includes('webserver') ? ':80' :
                     '';
        cPrint(`  ${proto.padEnd(11)}${(n.ip+':1024').padEnd(20)}${(nb.ip+port).padEnd(20)}HERGESTELLT`, 'ok');
      });
    }
    if (n.installedApps?.includes('webserver') && wsNodes[n.id]?.running) {
      cPrint(`  TCP          ${(n.ip+':80').padEnd(20)}0.0.0.0:*            LAUSCHEN`, 'ok');
    }

    cPrint('', 'sys');
    return true;
  }

  if (cmd === 'route') {
    const sub = parts[1]?.toLowerCase();
    cPrint('', 'sys');
    cPrint(`IPv4-Routentabelle von ${n.name}:`, 'info');
    cPrint('', 'sys');
    cPrint('  Netzwerkziel      Netzwerkmaske     Gateway           Metrik', 'sys');
    // Default local route
    if (n.ip) {
      const netAddr = n.ip.split('.').slice(0, 3).join('.') + '.0';
      cPrint(`  ${netAddr.padEnd(18)}${(n.mask||'255.255.255.0').padEnd(18)}Auf Verbindung  1`, 'ok');
      cPrint(`  ${'127.0.0.0'.padEnd(18)}${'255.0.0.0'.padEnd(18)}${'127.0.0.1'.padEnd(18)}1`, 'sys');
    }
    if (n.gw) {
      cPrint(`  ${'0.0.0.0'.padEnd(18)}${'0.0.0.0'.padEnd(18)}${n.gw.padEnd(18)}1`, 'ok');
    }
    (n.routingTable || []).forEach(r => {
      cPrint(`  ${r.dest.padEnd(18)}${r.mask.padEnd(18)}${r.gw.padEnd(18)}1`, 'ok');
    });
    cPrint('', 'sys');
    return true;
  }

  if (cmd === 'ls' || cmd === 'dir') {
    cPrint('', 'sys');
    cPrint(`Verzeichnis: C:\\Benutzer\\${n.name}\\`, 'info');
    cPrint('', 'sys');
    const files = [];
    if (!files.length) cPrint('  (Keine Dateien vorhanden)', 'warn');
    else files.forEach(f => cPrint(`  📄 ${f}`, 'ok'));
    cPrint('', 'sys');
    cPrint(`  ${files.length} Datei(en)   Apps: ${n.installedApps.length ? n.installedApps.map(a=>APP_META[a]?.name).join(', ') : 'keine'}`, 'sys');
    cPrint('', 'sys');
    return true;
  }

  if (cmd === 'cat' || cmd === 'type') {
    const fname = parts[1];
    if (!fname) { cPrint('Syntax: cat <dateiname>', 'err'); return true; }
    cPrint(`Datei '${fname}' nicht gefunden.`, 'err');
    return true;
  }

  if (cmd === 'ssh') {
    const target = parts[1];
    if (!target) { cPrint('Syntax: ssh <IP|Hostname>', 'err'); return true; }
    const ip = resolveHost(target, n);
    const dst = nodes.find(x => x.ip === ip);
    if (!dst || !dst.on) { cPrint(`ssh: Verbindung zu ${target} verweigert (Host nicht erreichbar)`, 'err'); return true; }
    const path = findPath(n, ip);
    if (!path) { cPrint(`ssh: Kein Netzwerkpfad zu ${ip}`, 'err'); return true; }
    animatePkt(path, '#7c3aed');
    setTimeout(() => {
      cPrint('', 'sys');
      cPrint(`SSH-Verbindung zu ${dst.name} (${ip}) hergestellt.`, 'ok');
      cPrint(`[${dst.name}] ~ Hinweis: SSH-Simulation — Befehle werden lokal ausgeführt.`, 'sys');
      cPrint(`[${dst.name}] ~ Tippe 'exit' um die Session zu beenden.`, 'sys');
      cPrint('', 'sys');
      if (captureActive) addCapture('SSH', `${n.ip} → ${ip} CONNECT`);
      log(`SSH: ${n.name} → ${dst.name}`, 'packet');
    }, 600);
    return true;
  }

  if (cmd === 'wget' || cmd === 'curl') {
    const url = parts[1];
    if (!url) { cPrint(`Syntax: ${cmd} <URL>`, 'err'); return true; }
    let host = url.replace(/^https?:\/\//, '').split('/')[0];
    const ip = resolveHost(host, n);
    const dst = nodes.find(x => x.ip === ip);
    cPrint('', 'sys');
    cPrint(`${cmd}: Verbinde mit ${host} (${ip})...`, 'info');
    if (!dst || !dst.on) { cPrint(`${cmd}: Verbindung fehlgeschlagen`, 'err'); return true; }
    const ws = wsNodes[dst.id];
    if (!dst.installedApps?.includes('webserver') || !ws?.running) {
      cPrint(`${cmd}: Verbindung abgelehnt — kein Webserver aktiv`, 'err');
      return true;
    }
    const path = findPath(n, ip);
    if (!path) { cPrint(`${cmd}: Kein Netzwerkpfad`, 'err'); return true; }
    animatePkt(path, '#2563eb', () => {
      cPrint(`HTTP-Anfrage gesendet: GET ${url}`, 'sys');
      cPrint(`HTTP/1.1 200 OK`, 'ok');
      cPrint(`Content-Type: text/html`, 'sys');
      const bytes = (ws.content || '').length;
      cPrint(`Content-Length: ${bytes}`, 'sys');
      cPrint('', 'sys');
      cPrint(`"index.html" gespeichert [${bytes} Bytes]`, 'ok');
      if (captureActive) addCapture('HTTP', `GET ${url} → 200 OK`);
      log(`${cmd}: ${n.name} → ${dst.name} → 200 OK`, 'packet');
    });
    return true;
  }

  return false; // not handled
}

function resolveHost(name, fromNode) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return name;
  const lower = name.toLowerCase();
  if (dnsEntries[lower]) return dnsEntries[lower];
  const byName = nodes.find(x => x.name.toLowerCase() === lower);
  if (byName) return byName.ip;
  return name;
}

// ════════════════════════════════════════════════════════════
// PING
// ════════════════════════════════════════════════════════════
function showPacketPath(path, src, dstIP) {
  const panel = document.getElementById('packet-path');
  const route = document.getElementById('pp-route');
  if (!path || !path.length) { panel.classList.remove('show'); return; }

  if (!panel.classList.contains('show')) panel.classList.add('show');

  const nodes = [src, ...path];
  route.innerHTML = nodes.map((n, i) => {
    const isLast = (i === nodes.length - 1);
    const content = `<div class="pp-node" title="${n.ip || n.mac}">🖥️ ${n.name}</div>`;
    return content + (isLast ? '' : '<span class="pp-arr">→</span>');
  }).join('');

  setTimeout(() => panel.classList.remove('show'), 6000);
}

function doPing(src, dstIP, count) {
  if (mode !== 'sim') { cPrint('⚠ Simulationsmodus nicht aktiv!', 'err'); return; }
  if (!src.ip) {
    cPrint('⚠ Keine IP konfiguriert!', 'err');
    cPrint('  Tipp: Gehe in den Entwurfs-Modus (Leertaste), klicke auf das Gerät und trage beim Netzwerk eine IPv4-Adresse ein.', 'warn');
    return;
  }
  if (!src.on) { cPrint('⚠ Gerät ist ausgeschaltet!', 'err'); return; }
  if (src.ip === dstIP) {
    cPrint('', 'sys'); cPrint(`Ping an ${dstIP}:`, 'info');
    for (let i = 0; i < count; i++) setTimeout(() => cPrint(`Antwort von ${dstIP}: Bytes=32 Zeit<1ms TTL=128`, 'ok'), i * 150);
    setTimeout(() => { cPrint('', 'sys'); cPrint(`Pakete: Gesendet=${count}, Empfangen=${count}, Verloren=0 (0%)`, 'ok'); }, count * 150 + 100);
    return;
  }
  const dst = nodes.find(x => x.ip === dstIP);
  cPrint('', 'sys'); cPrint(`Ping an ${dstIP}${dst ? ' [' + dst.name + ']' : ''}:`, 'info');
  if (!dst) {
    for (let i = 0; i < count; i++) setTimeout(() => cPrint('Zeitüberschreitung.', 'err'), i * 700);
    setTimeout(() => { cPrint('', 'sys'); cPrint(`Pakete: Gesendet=${count}, Empfangen=0, Verloren=${count} (100%)`, 'err'); }, count * 700 + 200);
    log(`PING ${src.name}→${dstIP}: Kein Host`, 'error'); return;
  }
  if (!dst.on) {
    cPrint(`Ziel ${dst.name} ist ausgeschaltet.`, 'warn');
    for (let i = 0; i < count; i++) setTimeout(() => cPrint('Zeitüberschreitung.', 'err'), i * 700);
    setTimeout(() => { cPrint('', 'sys'); cPrint(`Pakete: Gesendet=${count}, Empfangen=0, Verloren=${count} (100%)`, 'err'); }, count * 700 + 200); return;
  }
  const path = findPath(src, dstIP);
  if (!path) {
    // Erweitertes Educational Fehler-Feedback
    if (dst && src.ip && dst.ip && src.mask) {
      if (!sameSubnet(src.ip, dst.ip, src.mask) && !src.gw) {
        cPrint(`⚠ ${dst.name} ist in einem ANDEREN Subnetz!`, 'warn');
        cPrint(`  Deine IP: ${src.ip}  Ziel: ${dstIP}`, 'sys');
        cPrint(`  Lösung: Beide Geräte müssen im gleichen Netz sein, ODER du musst ein Gateway (Router) eintragen, das die Netze verbindet.`, 'warn');
      } else if (!sameSubnet(src.ip, dst.ip, src.mask) && src.gw) {
        cPrint(`⚠ Anderes Subnetz — Gateway gesetzt, aber kein Weg zum Ziel.`, 'warn');
        cPrint(`  Ist der Router ${src.gw} (Gateway) korrekt angeschlossen? Hat der Router IPs in beiden Subnetzen?`, 'sys');
      } else {
        cPrint(`⚠ Beide Geräte sind im gleichen Subnetz, aber es fehlt eine Kabelverbindung!`, 'warn');
        cPrint(`  Hast du vergessen einen Switch oder ein Kabel zu setzen?`, 'sys');
      }
    } else {
      cPrint(`Kein Pfad zu ${dstIP} — Kabelverbindung prüfen!`, 'warn');
    }
    for (let i = 0; i < count; i++) setTimeout(() => cPrint('Zeitüberschreitung.', 'err'), i * 700);
    setTimeout(() => { cPrint('', 'sys'); cPrint(`Pakete: Gesendet=${count}, Empfangen=0, Verloren=${count} (100%)`, 'err'); }, count * 700 + 200);
    log(`PING ${src.name}→${dstIP}: Kein Pfad`, 'error'); return;
  }
  showPacketPath(path, src, dstIP);
  log(`PING ${src.name}→${dst.name}(${dstIP})`, 'packet');
  if (captureActive) addCapture('ICMP', `${src.ip} → ${dstIP} Echo Request (${count}×)`);
  let sent = 0, rcvd = 0, rtts = [];
  function tick() {
    if (sent >= count) {
      const lost = count - rcvd, pct = Math.round(lost / count * 100);
      setTimeout(() => {
        cPrint('', 'sys'); cPrint(`Ping-Statistik für ${dstIP}:`, 'info');
        cPrint(`Pakete: Gesendet=${count}, Empfangen=${rcvd}, Verloren=${lost} (${pct}%)`, rcvd === count ? 'ok' : 'warn');
        if (rcvd > 0) {
          const mn = Math.min(...rtts).toFixed(0), mx = Math.max(...rtts).toFixed(0), avg = (rtts.reduce((a, b) => a + b) / rtts.length).toFixed(0);
          cPrint(`Min=${mn}ms, Max=${mx}ms, Mittel=${avg}ms`, 'ok');
        }
      }, 200);
      return;
    }
    const rtt = parseFloat((Math.random() * 6 + 0.5).toFixed(1)); rtts.push(rtt);
    animatePkt(path, '#2563eb', () => {
      cPrint(`Antwort von ${dstIP}: Bytes=32 Zeit=${rtt}ms TTL=${64 - path.length + 1}`, 'ok');
      animatePkt([...path].reverse(), '#16a34a');
      rcvd++; sent++; setTimeout(tick, 600);
    });
  }
  tick();
}

function doTracert(src, dstIP) {
  if (mode !== 'sim') { cPrint('⚠ Simulationsmodus nicht aktiv!', 'err'); return; }
  if (!src.ip) { cPrint('⚠ Keine IP!', 'err'); return; }
  const dst = nodes.find(x => x.ip === dstIP);
  cPrint('', 'sys');
  if (!dst) { cPrint(`Routenverfolgung zu ${dstIP}: Host nicht gefunden.`, 'err'); return; }
  const path = findPath(src, dstIP);
  if (!path) { cPrint(`Kein Pfad zu ${dstIP}.`, 'err'); return; }
  cPrint(`Routenverfolgung zu ${dstIP} [${dst.name}], max 30 Hops:`, 'info');
  cPrint('', 'sys');
  if (captureActive) addCapture('ICMP', `${src.ip} → ${dstIP} Traceroute`);
  log(`TRACERT ${src.name}→${dst.name}`, 'packet');
  path.forEach((hop, i) => {
    setTimeout(() => {
      const r1 = (Math.random() * 5 + 1).toFixed(0), r2 = (Math.random() * 5 + 1).toFixed(0), r3 = (Math.random() * 5 + 1).toFixed(0);
      cPrint(`  ${String(i + 1).padStart(2)}   ${r1}ms   ${r2}ms   ${r3}ms   ${(hop.ip || '*').padEnd(17)}[${hop.name}]`, i === path.length - 1 ? 'ok' : 'sys');
    }, i * 500);
  });
  setTimeout(() => { cPrint('', 'sys'); cPrint('Ablaufverfolgung beendet.', 'info'); cPrint('', 'sys'); }, path.length * 500 + 200);
}

// ════════════════════════════════════════════════════════════
// DNS WINDOW
// ════════════════════════════════════════════════════════════
function initDNSWindow() {
  renderDNSTable();
  document.getElementById('dns-start-btn').textContent = dnsRunning ? '■ DNS-Server stoppen' : '▶ DNS-Server starten';
  document.getElementById('dns-status').textContent = dnsRunning ? `✓ DNS-Server läuft auf ${dnsServerNode?.name || '?'}` : '';
}

function renderDNSTable() {
  const tbody = document.getElementById('dns-tbody');
  tbody.innerHTML = '';
  const entries = Object.entries(dnsEntries);
  if (!entries.length) { tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);padding:8px">Keine Einträge</td></tr>'; return; }
  entries.forEach(([host, ip]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${host}</td><td>${ip}</td><td>A</td><td><button onclick="dnsRemove('${host}')" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:11px">✕</button></td>`;
    tbody.appendChild(tr);
  });
}

function dnsAdd() {
  const h = document.getElementById('dns-host').value.trim().toLowerCase();
  const ip = document.getElementById('dns-ip-in').value.trim();
  if (!h || !ip) { notify('Hostname und IP angeben', 'error'); return; }
  dnsEntries[h] = ip;
  document.getElementById('dns-host').value = '';
  document.getElementById('dns-ip-in').value = '';
  renderDNSTable();
  log(`DNS: ${h} → ${ip}`, 'ok');
}

function dnsRemove(host) { delete dnsEntries[host]; renderDNSTable(); }

function dnsServerToggle() {
  dnsRunning = !dnsRunning;
  dnsServerNode = appWindowNode;
  document.getElementById('dns-start-btn').textContent = dnsRunning ? '■ DNS-Server stoppen' : '▶ DNS-Server starten';
  document.getElementById('dns-status').textContent = dnsRunning ? `✓ DNS-Server läuft auf ${dnsServerNode?.name}` : '';
  if (captureActive) addCapture('DNS', dnsRunning ? `Server gestartet auf ${dnsServerNode?.ip}` : 'Server gestoppt');
  log(`DNS-Server ${dnsRunning ? 'gestartet' : 'gestoppt'} auf ${dnsServerNode?.name}`, dnsRunning ? 'success' : 'warn');
}

// ════════════════════════════════════════════════════════════
// DHCP WINDOW
// ════════════════════════════════════════════════════════════
function initDHCPWindow() {
  document.getElementById('dhcp-start-btn').textContent = dhcpRunning ? '■ DHCP stoppen' : '▶ DHCP-Server starten';
  if (appWindowNode) document.getElementById('dhcp-gw').value = appWindowNode.gw || appWindowNode.ip || '';
}

function dhcpToggle() {
  dhcpRunning = !dhcpRunning;
  dhcpServerNode = appWindowNode;
  const btn = document.getElementById('dhcp-start-btn');
  btn.textContent = dhcpRunning ? '■ DHCP stoppen' : '▶ DHCP-Server starten';
  const statusEl = document.getElementById('dhcp-status');
  if (dhcpRunning) {
    const from = document.getElementById('dhcp-from').value;
    const to = document.getElementById('dhcp-to').value;
    statusEl.style.display = 'block';
    statusEl.textContent = `DHCP aktiv: ${from} – ${to}`;
    log(`DHCP-Server gestartet auf ${dhcpServerNode?.name} (${from}–${to})`, 'success');
    if (captureActive) addCapture('DHCP', `Server gestartet, Bereich: ${from}–${to}`);
    // Assign to DHCP-enabled nodes
    nodes.filter(n => n.dhcpEnabled).forEach(n => assignDHCP(n));
  } else {
    statusEl.style.display = 'none';
    log('DHCP-Server gestoppt', 'warn');
  }
}

let dhcpNext = 100;
function assignDHCP(n) {
  if (!dhcpRunning) return;
  const from = document.getElementById('dhcp-from')?.value || '192.168.1.100';
  const base = from.split('.').slice(0, 3).join('.');
  n.ip = base + '.' + dhcpNext++;
  n.mask = '255.255.255.0';
  n.gw = document.getElementById('dhcp-gw')?.value || dhcpServerNode?.ip || '';
  n.dns = document.getElementById('dhcp-dns-out')?.value || '';
  refreshNode(n);
  log(`DHCP: ${n.name} → ${n.ip}`, 'success');
  if (captureActive) addCapture('DHCP', `${n.name} ← ${n.ip}`);
}

// ════════════════════════════════════════════════════════════
// WEBSERVER WINDOW
// ════════════════════════════════════════════════════════════
function initWebserverWindow() {
  const nodeId = appWindowNode?.id;
  if (!wsNodes[nodeId]) wsNodes[nodeId] = { running: false, content: document.getElementById('webserver-content').value };
  const ws = wsNodes[nodeId];
  document.getElementById('webserver-content').value = ws.content;
  document.getElementById('ws-start-btn').textContent = ws.running ? '■ Server stoppen' : '▶ Server starten';
  document.getElementById('ws-status').textContent = ws.running ? `✓ Webserver läuft auf http://${appWindowNode?.ip}` : '';
}
function webserverSave() {
  const nodeId = appWindowNode?.id;
  if (!wsNodes[nodeId]) wsNodes[nodeId] = { running: false, content: '' };
  wsNodes[nodeId].content = document.getElementById('webserver-content').value;
  notify('💾 Webseite gespeichert', 'success');
}
function webserverToggle() {
  const nodeId = appWindowNode?.id;
  if (!wsNodes[nodeId]) wsNodes[nodeId] = { running: false, content: '' };
  const ws = wsNodes[nodeId];
  ws.content = document.getElementById('webserver-content').value;
  ws.running = !ws.running;
  document.getElementById('ws-start-btn').textContent = ws.running ? '■ Server stoppen' : '▶ Server starten';
  document.getElementById('ws-status').textContent = ws.running
    ? `✓ Webserver läuft auf http://${appWindowNode?.ip}`
    : 'Server gestoppt.';
  log(`Webserver ${ws.running ? 'gestartet auf ' + appWindowNode?.ip : 'gestoppt'}`, ws.running ? 'success' : 'warn');
  notify(ws.running ? `✓ Webserver gestartet` : 'Webserver gestoppt', ws.running ? 'success' : 'warn');
}
// ════════════════════════════════════════════════════════════
// BROWSER WINDOW
// ════════════════════════════════════════════════════════════
function browserGo() {
  const url = document.getElementById('browser-url').value.trim();
  if (!url) return;
  const view = document.getElementById('browser-view');

  // Extract host
  let host = url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];

  // Resolve hostname → IP
  let targetIP = host;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const lower = host.toLowerCase();
    if (dnsEntries[lower]) targetIP = dnsEntries[lower];
    else {
      const dn = nodes.find(x => x.name.toLowerCase() === lower);
      if (dn) targetIP = dn.ip;
      else {
        view.innerHTML = `<div style="padding:20px;color:#c0392b;font-family:sans-serif">
          <b>DNS-Fehler</b><br><br>
          Der Hostname <b>${host}</b> konnte nicht gefunden werden.<br><br>
          <small>💡 Tipp: DNS-Server auf einem Server installieren, starten und einen Eintrag für <b>${host}</b> hinzufügen. Dann im PC unter "Netzwerk" den DNS-Server eintragen.</small>
        </div>`;
        return;
      }
    }
  }

  // Find server node
  const serverNode = nodes.find(x => x.ip === targetIP);
  if (!serverNode || !serverNode.on) {
    view.innerHTML = `<div style="padding:20px;color:#c0392b;font-family:sans-serif">
      <b>Verbindung fehlgeschlagen</b><br><br>
      Kein Gerät mit der IP <b>${targetIP}</b> erreichbar oder Gerät ausgeschaltet.
    </div>`;
    return;
  }

  // Check path
  const browsingNode = appWindowNode;
  if (browsingNode && browsingNode.ip !== targetIP) {
    const path = findPath(browsingNode, targetIP);
    if (!path) {
      view.innerHTML = `<div style="padding:20px;color:#e67e22;font-family:sans-serif">
        <b>Netzwerkfehler</b><br><br>
        Kein Weg zu <b>${targetIP}</b>.<br><br>
        <small>💡 Tipp: Kabel überprüfen und sicherstellen, dass alle Geräte verbunden sind.</small>
      </div>`;
      return;
    }
  }

  // Check webserver
  const ws = wsNodes[serverNode.id];
  if (!serverNode.installedApps.includes('webserver')) {
    view.innerHTML = `<div style="padding:20px;color:#c0392b;font-family:sans-serif">
      <b>Fehler 404</b><br><br>
      Auf <b>${serverNode.name}</b> (${targetIP}) ist kein Webserver installiert.<br><br>
      <small>💡 Tipp: Wähle den Server aus → Reiter "Apps" → Webserver installieren → öffnen → starten.</small>
    </div>`;
    return;
  }
  if (!ws || !ws.running) {
    view.innerHTML = `<div style="padding:20px;color:#e67e22;font-family:sans-serif">
      <b>Verbindung abgelehnt</b><br><br>
      Der Webserver auf <b>${serverNode.name}</b> ist nicht gestartet.<br><br>
      <small>💡 Tipp: Doppelklick auf den Server im Simulationsmodus → App "Webserver" öffnen → "Server starten" klicken.</small>
    </div>`;
    return;
  }

  // Animate packet and show page
  if (browsingNode && browsingNode.ip !== targetIP) {
    const path = findPath(browsingNode, targetIP);
    if (path) animatePkt(path, '#2563eb');
  }
  if (captureActive) addCapture('HTTP', `GET http://${host}/ → ${targetIP}`);
  log(`HTTP GET ${url} → ${serverNode.name}`, 'packet');

  const pageContent = ws.content || '<h1>Willkommen!</h1><p>Standardseite.</p>';
  view.innerHTML = `<div style="padding:0;width:100%;height:100%;background:#fff;overflow:auto">
    <div style="background:#e8f0fe;padding:6px 10px;font-size:10px;color:#4285f4;font-weight:700;border-bottom:1px solid #d2e3fc">
      🔒 http://${host} — ${serverNode.name} (${targetIP})
    </div>
    <div style="padding:12px;font-family:Arial,sans-serif">${pageContent}</div>
  </div>`;
}

// ── Desktop-interner Browser ─────────────────────────────────
function dtBrowserGo() {
  const urlInput = document.getElementById('dt-browser-url');
  const view     = document.getElementById('dt-browser-view');
  if (!urlInput || !view) return;
  const url = urlInput.value.trim();
  if (!url) return;
  _dtBrowserState.url = url;

  const err = (icon, title, msg, tip) => {
    const html = `<div style="padding:24px 20px;font-family:Arial,sans-serif">
      <div style="font-size:22px;margin-bottom:8px">${icon}</div>
      <b style="font-size:15px">${title}</b>
      <p style="margin:10px 0 0;color:#444;font-size:13px">${msg}</p>
      <div style="margin-top:12px;font-size:12px;background:#f8f9fa;border-left:3px solid #ccc;padding:8px 12px;border-radius:4px;color:#555">${tip}</div>
    </div>`;
    view.innerHTML = html; _dtBrowserState.html = html;
  };

  let host = url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  let targetIP = host;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const lower = host.toLowerCase();
    if (dnsEntries[lower]) targetIP = dnsEntries[lower];
    else {
      const dn = nodes.find(x => x.name.toLowerCase() === lower);
      if (dn) targetIP = dn.ip;
      else return err('🔴', 'DNS-Fehler', `Hostname <b>${host}</b> konnte nicht aufgelöst werden.`,
        `💡 DNS-Server auf einem Server installieren, Eintrag für <b>${host}</b> anlegen und im PC als DNS-Server eintragen.`);
    }
  }

  const serverNode = nodes.find(x => x.ip === targetIP);
  if (!serverNode || !serverNode.on)
    return err('🔴', 'Verbindung fehlgeschlagen', `Kein Gerät mit IP <b>${targetIP}</b> erreichbar oder ausgeschaltet.`,
      '💡 Prüfe ob das Zielgerät eingeschaltet ist und die richtige IP konfiguriert hat.');

  const browsingNode = appWindowNode;
  if (browsingNode && browsingNode.ip !== targetIP) {
    const path = findPath(browsingNode, targetIP);
    if (!path) return err('🟠', 'Netzwerkfehler', `Kein Pfad zu <b>${targetIP}</b> gefunden.`,
      '💡 Überprüfe Kabelverbindungen — alle Geräte auf dem Weg müssen verbunden sein.');
  }

  if (!serverNode.installedApps?.includes('webserver'))
    return err('🔴', 'Fehler 404', `Auf <b>${serverNode.name}</b> (${targetIP}) ist kein Webserver installiert.`,
      '💡 Server auswählen → Reiter "Apps" → Webserver installieren → öffnen → starten.');

  const ws = wsNodes[serverNode.id];
  if (!ws || !ws.running)
    return err('🟠', 'Verbindung abgelehnt', `Webserver auf <b>${serverNode.name}</b> ist nicht gestartet.`,
      '💡 Doppelklick auf den Server → App "Webserver" öffnen → "Server starten" klicken.');

  if (browsingNode && browsingNode.ip !== targetIP) {
    const path = findPath(browsingNode, targetIP);
    if (path) animatePkt(path, '#2563eb');
  }
  if (captureActive) addCapture('HTTP', `GET http://${host}/ → ${targetIP}`);
  log(`HTTP GET ${url} → ${serverNode.name}`, 'packet');

  const pageContent = ws.content || '<h1>Willkommen!</h1><p>Standardseite.</p>';
  const html = `<div style="display:flex;flex-direction:column;height:100%">
    <div style="background:#e8f0fe;padding:6px 10px;font-size:10px;color:#4285f4;font-weight:700;border-bottom:1px solid #d2e3fc;flex-shrink:0">
      🔒 http://${host} — ${serverNode.name} (${targetIP})
    </div>
    <div style="flex:1;overflow-y:auto;padding:14px;font-family:Arial,sans-serif">${pageContent}</div>
  </div>`;
  view.innerHTML = html;
  _dtBrowserState.html = html;
}
// ════════════════════════════════════════════════════════════
// EMAIL
// ════════════════════════════════════════════════════════════
function emailSend() {
  const to = document.getElementById('email-to').value.trim();
  const subj = document.getElementById('email-subj').value.trim();
  const body = document.getElementById('email-body').value.trim();
  const from = document.getElementById('email-addr').value.trim();
  if (!to || !subj) { notify('Empfänger und Betreff angeben', 'error'); return; }

  const targetNode = nodes.find(x => x.ip === to || x.name.toLowerCase() === to.toLowerCase());
  if (!targetNode) { notify('Empfänger nicht gefunden', 'error'); return; }

  const src = appWindowNode || cmdNode;
  const path = src ? findPath(src, targetNode.ip) : null;
  if (path) {
    animatePkt(path, '#ca8a04', () => {
      if (!emailInboxes[targetNode.id]) emailInboxes[targetNode.id] = [];
      emailInboxes[targetNode.id].push({ from: from || src?.ip || '?', subj, body, time: now() });
      notify('✉ E-Mail gesendet!', 'success');
      log(`E-Mail: ${from} → ${to}: "${subj}"`, 'packet');
      if (captureActive) addCapture('SMTP', `${from} → ${to}: ${subj}`);
    });
  } else {
    if (!emailInboxes[targetNode.id]) emailInboxes[targetNode.id] = [];
    emailInboxes[targetNode.id].push({ from: from || '?', subj, body, time: now() });
    notify('✉ E-Mail gesendet!', 'success');
  }
  document.getElementById('email-body').value = '';
  document.getElementById('email-subj').value = '';
}

function emailFetch() {
  const n = appWindowNode || cmdNode;
  if (!n) return;
  const inbox = emailInboxes[n.id] || [];
  const el = document.getElementById('email-inbox');
  if (!inbox.length) { el.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:11px">Posteingang leer</div>'; return; }
  el.innerHTML = '';
  inbox.forEach(m => {
    const d = document.createElement('div');
    d.className = 'email-item';
    d.innerHTML = `<div class="email-from">Von: ${m.from}</div><div class="email-subj">${m.subj}</div><div class="email-time">${m.time}</div>`;
    d.onclick = () => alert(`Von: ${m.from}\nBetreff: ${m.subj}\n\n${m.body}`);
    el.appendChild(d);
  });
  if (captureActive) addCapture('POP3', `Abruf Posteingang: ${inbox.length} Nachrichten`);
}

// ════════════════════════════════════════════════════════════
// ECHO SERVER / CLIENT
// ════════════════════════════════════════════════════════════
function initEchoWindow(isServer) {
  document.getElementById('echo-server-cfg').style.display = isServer ? 'block' : 'none';
  document.getElementById('echo-client-cfg').style.display = isServer ? 'none' : 'block';
  document.getElementById('echo-title').textContent = isServer ? '📡 Echo-Server' : '💬 Einfacher Client';
  document.getElementById('echo-start-btn').textContent = echoRunning ? '■ Server stoppen' : '▶ Echo-Server starten';
}

function echoToggle() {
  echoRunning = !echoRunning;
  echoNode = appWindowNode;
  document.getElementById('echo-start-btn').textContent = echoRunning ? '■ Server stoppen' : '▶ Echo-Server starten';
  const out = document.getElementById('echo-output');
  out.textContent += `\n[${now()}] Echo-Server ${echoRunning ? 'gestartet auf Port ' + document.getElementById('echo-port').value : 'gestoppt'}`;
  log(`Echo-Server ${echoRunning ? 'gestartet' : 'gestoppt'}`, echoRunning ? 'success' : 'warn');
}

function echoSend() {
  const targetIP = document.getElementById('echo-target-ip').value.trim();
  const port = document.getElementById('echo-target-port').value;
  const msg = document.getElementById('echo-msg').value.trim();
  if (!targetIP || !msg) { notify('Server-IP und Nachricht angeben', 'error'); return; }

  const src = appWindowNode;
  const path = src ? findPath(src, targetIP) : null;
  const out = document.getElementById('echo-output');
  out.textContent += `\n[${now()}] Sende: "${msg}" → ${targetIP}:${port}`;
  document.getElementById('echo-msg').value = '';

  if (path) {
    animatePkt(path, '#0891b2', () => {
      animatePkt([...path].reverse(), '#16a34a', () => {
        out.textContent += `\nEcho: "${msg}"`;
        out.scrollTop = out.scrollHeight;
      });
    });
  } else {
    out.textContent += `\nFehler: Kein Pfad zu ${targetIP}`;
  }
}

// ════════════════════════════════════════════════════════════
// ROUTING TABLE WINDOW
// ════════════════════════════════════════════════════════════
function initRoutingWindow() {
  if (appWindowNode) { renderRoutingTable(appWindowNode); }
}

function renderRoutingTable(n) {
  const tbody = document.getElementById('rt-tbody');
  tbody.innerHTML = '';
  const routes = n.routingTable || [];
  if (!routes.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);padding:8px">Keine Routen</td></tr>'; return; }
  routes.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.dest}</td><td>${r.mask}</td><td>${r.gw}</td><td>1</td>
      <td><button onclick="rtRemove(${i})" style="background:none;border:none;cursor:pointer;color:var(--red)">✕</button></td>`;
    tbody.appendChild(tr);
  });
}

function rtAdd() {
  const dest = document.getElementById('rt-dest').value.trim();
  const mask = document.getElementById('rt-mask').value.trim();
  const gw = document.getElementById('rt-gw-in').value.trim();
  if (!dest || !gw) return;
  const n = appWindowNode;
  if (!n) return;
  n.routingTable = n.routingTable || [];
  n.routingTable.push({ dest, mask, gw });
  renderRoutingTable(n);
  log(`Route hinzugefügt: ${dest} via ${gw} auf ${n.name}`, 'ok');
}

function rtRemove(i) {
  const n = appWindowNode; if (!n) return;
  n.routingTable.splice(i, 1); renderRoutingTable(n);
}

// ════════════════════════════════════════════════════════════
// DOCUMENTATION MODE — Notes
// ════════════════════════════════════════════════════════════
function addNote(x, y) {
  const area = document.getElementById('canvas-area');
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:absolute;left:${x}px;top:${y}px;z-index:15;pointer-events:all;`;

  const note = document.createElement('div');
  note.className = 'doc-note';
  note.style.cssText = 'position:relative;left:0;top:0;min-width:150px;min-height:52px;';
  note.contentEditable = 'true';
  note.textContent = '📝 Notiz eingeben...';

  // Delete button
  const del = document.createElement('button');
  del.className = 'doc-note-del';
  del.title = 'Notiz löschen';
  del.textContent = '✕';
  del.onclick = e => { e.stopPropagation(); wrap.remove(); };

  note.appendChild(del);

  // Clear placeholder on first focus
  let cleared = false;
  note.onfocus = () => {
    if (!cleared) {
      // Remove placeholder — keep only delete button
      note.textContent = '';
      note.appendChild(del);
      cleared = true;
    }
  };

  // Dragging via mousedown on note background (not while editing)
  let dragging = false, ox = 0, oy = 0;
  note.onmousedown = e => {
    if (e.target === del) return;
    if (document.activeElement === note) return; // let editing happen
    dragging = true;
    ox = e.clientX - wrap.offsetLeft;
    oy = e.clientY - wrap.offsetTop;
    e.preventDefault();
    const mv = ev => { if (!dragging) return; wrap.style.left = (ev.clientX - ox) + 'px'; wrap.style.top = (ev.clientY - oy) + 'px'; };
    const up = () => { dragging = false; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  };
  note.ondblclick = e => { e.stopPropagation(); note.focus(); };

  wrap.appendChild(note);
  area.appendChild(wrap);
  setTimeout(() => { note.focus(); }, 60);
}

// ════════════════════════════════════════════════════════════
// CONTEXT MENU
// ════════════════════════════════════════════════════════════
function showCtx(e, n) {
  ctxTarget = n;
  const m = document.getElementById('ctx-menu');
  m.style.display = 'block';
  m.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  m.style.top = Math.min(e.clientY, window.innerHeight - 250) + 'px';
}
function hideCtx() { document.getElementById('ctx-menu').style.display = 'none'; }
function ctxDo(a) {
  hideCtx(); if (!ctxTarget) return;
  if (a === 'delete') removeNode(ctxTarget);
  else if (a === 'config') select(ctxTarget);
  else if (a === 'terminal') { if (mode !== 'sim') setMode('sim'); openDesktop(ctxTarget); }
  else if (a === 'rename') {
    const name = prompt('Neuer Name:', ctxTarget.name);
    if (name) { ctxTarget.name = name; refreshNode(ctxTarget); if (selNode === ctxTarget) showCfg(ctxTarget); }
  }
  else if (a === 'power') {
    ctxTarget.on = !ctxTarget.on; refreshNode(ctxTarget); draw();
    log(`${ctxTarget.name} → ${ctxTarget.on ? 'EIN' : 'AUS'}`, ctxTarget.on ? 'success' : 'warn');
  }
}
document.addEventListener('click', e => {
  if (!e.target.closest('#ctx-menu')) hideCtx();
});

// ════════════════════════════════════════════════════════════
// EVENT LOG
// ════════════════════════════════════════════════════════════
function log(msg, type = 'info') {
  const el = document.getElementById('event-log');
  const d = document.createElement('div');
  d.className = 'log-line ' + type;
  d.innerHTML = `<span class="log-time">${now()}</span><span class="log-msg">${msg}</span>`;
  el.appendChild(d); el.scrollTop = el.scrollHeight;
}

function clearLog() { document.getElementById('event-log').innerHTML = ''; }

function addCapture(proto, info) {
  const el = document.getElementById('capture-log');
  const d = document.createElement('div');
  d.className = 'cap-line';
  const cls = proto === 'ICMP' ? 'proto-icmp' : proto === 'DNS' ? 'proto-dns' : proto === 'HTTP' ? 'proto-http' : proto === 'DHCP' ? 'proto-dhcp' : proto === 'SMTP' ? 'proto-smtp' : '';
  d.innerHTML = `<span class="cap-time">${now()}</span><span class="cap-proto ${cls}">${proto}</span><span class="cap-info">${info}</span>`;
  el.appendChild(d); el.scrollTop = el.scrollHeight;
}

function clearCapture() { document.getElementById('capture-log').innerHTML = ''; }

function updateSB() {
  document.getElementById('sb-nodes').textContent = nodes.length;
  document.getElementById('sb-cables').textContent = cables.length;
}

function now() { return new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

// ════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════
function notify(msg, type = 'info') {
  const container = document.getElementById('notif');
  const d = document.createElement('div');
  d.className = 'notif-item ' + type;
  d.innerHTML = `<span class="notif-text">${msg}</span>`;
  container.appendChild(d);
  setTimeout(() => d.style.opacity = '0', 3000);
  setTimeout(() => d.remove(), 3400);
}

// ════════════════════════════════════════════════════════════
// SAVE / LOAD
// ════════════════════════════════════════════════════════════
function saveNet() {
  const data = JSON.stringify({ nodes: nodes.map(n => ({ ...n, el: undefined })), cables, dnsEntries, version: '3' });

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.postMessage(JSON.stringify({ action: 'save', payload: data }));
  } else {
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'netzwerk.json'; a.click();
    notify('💾 Netzwerk gespeichert', 'success');
    log('Netzwerk als netzwerk.json gespeichert', 'ok');
  }
}

function loadNet() {
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.postMessage(JSON.stringify({ action: 'load' }));
  } else {
    document.getElementById('file-load').click();
  }
}

// Handler for WebView2 C# response
if (window.chrome && window.chrome.webview) {
  window.chrome.webview.addEventListener('message', ev => {
    if (ev.data) loadDataObj(ev.data);
  });
}

function loadDataObj(jsonString) {
  try {
    clearAll();
    const data = JSON.parse(jsonString);
    dnsEntries = data.dnsEntries || {};
    const idMap = {};
    data.nodes.forEach(nd => {
      const n = addNode(nd.type, nd.x, nd.y);
      idMap[nd.id] = n.id;
      Object.assign(n, nd, { id: n.id, el: n.el });
      refreshNode(n);
    });
    data.cables.forEach(c => {
      const a = nodes.find(n => n.id === idMap[c.a]), b = nodes.find(n => n.id === idMap[c.b]);
      if (a && b) addCable(a, b);
    });
    notify('📂 Netzwerk geladen', 'success');
  } catch (err) {
    console.error(err);
    notify('Fehler beim Laden', 'error');
  }
}

function loadFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    loadDataObj(ev.target.result);
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function genMAC() { return Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()).join('-'); }

function clearAll() {
  nodes.forEach(n => n.el?.remove());
  nodes = []; cables = []; dnsEntries = {}; dhcpRunning = false; wsNodes = {}; echoRunning = false;
  nextId = 1; // Reset IDs so everything starts clean!
  draw(); updateSB(); select(null);
  document.getElementById('empty-state').style.display = 'block';
  ipCounters = { pc: 10, laptop: 20, router: 1, switch: 0, hub: 0, ap: 50, server: 100, modem: 0 };
  dhcpNext = 100;
  log('Netzwerk zurückgesetzt', 'warn');
}

function showHelp() { document.getElementById('help-panel').classList.toggle('open'); }

// ════════════════════════════════════════════════════════════
// EXAMPLE NETWORK
// ════════════════════════════════════════════════════════════
function loadExample() {
  clearAll();
  const W = cvs.width, H = cvs.height, mx = W / 2, my = H / 2;
  const r1 = addNode('router', mx, my - 180);
  const sw1 = addNode('switch', mx - 200, my - 20);
  const sw2 = addNode('switch', mx + 200, my - 20);
  const srv = addNode('server', mx, my - 20);
  const pc1 = addNode('pc', mx - 310, my + 140);
  const pc2 = addNode('pc', mx - 140, my + 140);
  const lt1 = addNode('laptop', mx + 100, my + 140);
  const pc3 = addNode('pc', mx + 290, my + 140);

  r1.ip = '10.0.0.1'; r1.name = 'Gateway';
  sw1.name = 'Switch-Büro'; sw2.name = 'Switch-Labor';
  srv.ip = '192.168.1.100'; srv.name = 'Webserver'; srv.gw = '10.0.0.1';
  srv.installedApps = ['webserver', 'dnsserver', 'dhcpserver', 'emailserver'];
  pc1.ip = '192.168.1.10'; pc1.name = 'Büro-PC-1'; pc1.gw = '10.0.0.1'; pc1.installedApps = ['webbrowser'];
  pc2.ip = '192.168.1.11'; pc2.name = 'Büro-PC-2'; pc2.gw = '10.0.0.1'; pc2.installedApps = ['webbrowser'];
  lt1.ip = '192.168.2.10'; lt1.name = 'Labor-Laptop'; lt1.gw = '10.0.0.1'; lt1.installedApps = ['webbrowser'];
  pc3.ip = '192.168.2.11'; pc3.name = 'Labor-PC'; pc3.gw = '10.0.0.1'; pc3.installedApps = ['webbrowser'];

  dnsEntries['www.schule.de'] = '192.168.1.100';
  dnsEntries['mail.schule.de'] = '192.168.1.100';

  nodes.forEach(n => refreshNode(n));
  addCable(r1, sw1); addCable(r1, sw2); addCable(r1, srv);
  addCable(sw1, pc1); addCable(sw1, pc2); addCable(sw2, lt1); addCable(sw2, pc3);

  log('Beispielnetzwerk geladen! Wechsle in Simulation und teste mit ping', 'success');
  notify('✓ Beispielnetzwerk geladen', 'success');
}

// ════════════════════════════════════════════════════════════
// TASK SYSTEM
// ════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') return;
  if (e.key === 'c' || e.key === 'C') toggleCable();
  if (e.key === 'd' || e.key === 'D') toggleDelete();
  if (e.key === 'Delete' && selNode) removeNode(selNode);
  if (e.key === 'Escape') {
    if (document.getElementById('dt-overlay').style.display === 'flex') { closeDesktop(); return; }
    if (document.getElementById('cmd-overlay').classList.contains('visible')) closeCMD();
    if (document.getElementById('help-panel').classList.contains('open')) showHelp();
    if (cableMode) toggleCable();
    if (deleteMode) toggleDelete();
    closeAllApps();
  }
  if (e.key === ' ') { e.preventDefault(); setMode(mode === 'design' ? 'sim' : 'design'); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveNet(); }
});

// Window drag for CMD
(function () {
  const win = document.getElementById('cmd-window');
  const bar = document.getElementById('cmd-titlebar');
  let down = false, sx, sy, ox, oy;
  bar.addEventListener('mousedown', e => {
    if (e.target.classList.contains('cmd-dot')) return;
    down = true; sx = e.clientX; sy = e.clientY;
    const r = win.getBoundingClientRect(); ox = r.left; oy = r.top;
    win.style.position = 'fixed'; win.style.margin = '0';
  });
  document.addEventListener('mousemove', e => { if (!down) return; win.style.left = (ox + e.clientX - sx) + 'px'; win.style.top = (oy + e.clientY - sy) + 'px'; });
  document.addEventListener('mouseup', () => down = false);
})();

// Generic app window drag
document.querySelectorAll('[id^="drag-"]').forEach(bar => {
  const win = bar.closest('.app-window');
  let down = false, sx, sy, ox, oy;
  bar.addEventListener('mousedown', e => {
    if (e.target.classList.contains('aw-dot')) return;
    down = true; sx = e.clientX; sy = e.clientY;
    const r = win.getBoundingClientRect(); ox = r.left; oy = r.top;
    win.style.position = 'fixed'; win.style.margin = '0';
    win.style.zIndex = 700 + nextId++;
  });
  document.addEventListener('mousemove', e => { if (!down) return; win.style.left = (ox + e.clientX - sx) + 'px'; win.style.top = (oy + e.clientY - sy) + 'px'; });
  document.addEventListener('mouseup', () => down = false);
});

// Right panel tab - also open apps from terminal's desktop mode
document.getElementById('ctab-content-apps').addEventListener('dblclick', e => {
  const item = e.target.closest('.app-item');
  if (!item || !selNode) return;
  const idx = [...item.parentNode.children].indexOf(item);
  const avail = APPS[selNode.type] || [];
  if (avail[idx]) openAppWindow(avail[idx], selNode);
});
// Click installed app to open it
document.getElementById('ctab-content-apps').addEventListener('click', e => {
  const item = e.target.closest('.app-item.installed');
  if (!item || !selNode || mode !== 'sim') return;
  const idx = [...item.parentNode.children].indexOf(item);
  const avail = APPS[selNode.type] || [];
  if (avail[idx]) openAppWindow(avail[idx], selNode);
});

// ════════════════════════════════════════════════════════════
// INIT & AUTO-SAVE
// ════════════════════════════════════════════════════════════
function loadAutoSave() {
  try {
    const saved = localStorage.getItem('netsim_autosave');
    if (saved) {
      clearAll();
      const data = JSON.parse(saved);
      dnsEntries = data.dnsEntries || {};
      const idMap = {};
      data.nodes.forEach(nd => {
        const n = addNode(nd.type, nd.x, nd.y);
        idMap[nd.id] = n.id;
        Object.assign(n, nd, { id: n.id, el: n.el });
        refreshNode(n);
      });
      data.cables.forEach(c => {
        const a = nodes.find(n => n.id === idMap[c.a]), b = nodes.find(n => n.id === idMap[c.b]);
        if (a && b) addCable(a, b);
      });
      notify('Letzter Auto-Save geladen', 'success');
      return true;
    }
  } catch (e) {
    console.error('AutoSave fail', e);
  }
  return false;
}

setTimeout(() => {
  resize();
  if (!loadAutoSave()) {
    log('NetSim bereit — ziehe Geräte auf die Arbeitsfläche und vergib IP-Adressen!', 'success');
    log('💡 Tipp: Leertaste = Modus wechseln · C = Kabel · D = Löschen · Doppelklick = Terminal', 'info');
    log('📚 Klicke rechts auf "Aufgaben" für 6 geführte Aufgaben (Aufgabe 1 ist offen zum Start).', 'info');
    log('⚠ IPs werden nicht automatisch vergeben — du musst sie selbst festlegen!', 'warn');
  } else {
    log('Dein Netzwerk wurde aus dem automatischen Speicher wiederhergestellt.', 'ok');
  }
}, 80);

// Auto-Save Loop (every 30 seconds)
setInterval(() => {
  if (nodes.length === 0) return;
  const data = JSON.stringify({ nodes: nodes.map(n => ({ ...n, el: undefined })), cables, dnsEntries, version: '3' });
  localStorage.setItem('netsim_autosave', data);

  // Show a subtle auto-save label in status bar
  const sb = document.getElementById('sb-cables');
  const org = sb.textContent;
  sb.innerHTML = `<span style="color:var(--green)">💾 Gerettet</span>`;
  setTimeout(() => updateSB(), 2000);
}, 30000);

// Draggable cfg window
(function () {
  const win = document.getElementById('cfg-window');
  const titlebar = document.getElementById('cfw-titlebar');
  if (!win || !titlebar) return;
  let ox = 0, oy = 0, dragging = false, startRight = 0, startTop = 0;
  titlebar.addEventListener('mousedown', e => {
    if (e.target.classList.contains('cfw-dot')) return;
    dragging = true;
    const r = win.getBoundingClientRect();
    ox = e.clientX; oy = e.clientY;
    startRight = window.innerWidth - r.right;
    startTop = r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - ox, dy = e.clientY - oy;
    win.style.right = (startRight - dx) + 'px';
    win.style.top = Math.max(65, startTop + dy) + 'px';
  });
  document.addEventListener('mouseup', () => dragging = false);
})();
// ════════════════════════════════════════════════════════════
// SUBNET CALCULATOR
// ════════════════════════════════════════════════════════════
function prefixFromMask(mask) {
  try {
    return mask.split('.').reduce((a, b) => a + parseInt(b).toString(2).split('').filter(x=>x==='1').length, 0);
  } catch(e) { return 24; }
}

function subnetInfo(ip, prefix) {
  try {
    prefix = parseInt(prefix);
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return null;
    const ipParts = ip.split('.').map(Number);
    if (ipParts.length !== 4 || ipParts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
    const ipNum = ipParts.reduce((a, b) => (a << 8) | b, 0) >>> 0;
    const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    const network = (ipNum & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    const toIP = n => [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.');
    const hosts = prefix >= 31 ? (prefix === 32 ? 1 : 2) : Math.pow(2, 32 - prefix) - 2;
    const firstHost = prefix < 31 ? toIP(network + 1) : toIP(network);
    const lastHost = prefix < 31 ? toIP(broadcast - 1) : toIP(broadcast);
    const maskStr = toIP(mask);
    const classes = prefix <= 8 ? 'A' : prefix <= 16 ? 'B' : prefix <= 24 ? 'C' : 'D/E';
    return {
      network: toIP(network),
      broadcast: toIP(broadcast),
      mask: maskStr,
      cidr: `${toIP(network)}/${prefix}`,
      firstHost, lastHost,
      hosts: hosts.toLocaleString('de-DE'),
      prefix,
      ipClass: classes
    };
  } catch(e) { return null; }
}

function calcSubnet() {
  const ip = document.getElementById('sn-ip').value.trim();
  const prefix = document.getElementById('sn-prefix').value.trim();
  const res = document.getElementById('sn-result');
  if (!ip || !prefix) {
    res.innerHTML = '<span style="color:var(--muted)">IP und Präfixlänge eingeben…</span>';
    return;
  }
  const info = subnetInfo(ip, prefix);
  if (!info) {
    res.innerHTML = '<span style="color:var(--red)">⚠ Ungültige Eingabe — z.B. 192.168.1.0 / 24</span>';
    return;
  }
  res.innerHTML = `
    <div style="display:grid;gap:3px">
      <div><span style="color:var(--muted);display:inline-block;width:130px">Netzadresse:</span> <strong style="color:var(--accent)">${info.network}</strong></div>
      <div><span style="color:var(--muted);display:inline-block;width:130px">Subnetzmaske:</span> <strong>${info.mask}</strong></div>
      <div><span style="color:var(--muted);display:inline-block;width:130px">Broadcast:</span> <strong style="color:var(--red)">${info.broadcast}</strong></div>
      <div><span style="color:var(--muted);display:inline-block;width:130px">Erster Host:</span> <strong style="color:var(--green)">${info.firstHost}</strong></div>
      <div><span style="color:var(--muted);display:inline-block;width:130px">Letzter Host:</span> <strong style="color:var(--green)">${info.lastHost}</strong></div>
      <div><span style="color:var(--muted);display:inline-block;width:130px">Nutzbare Hosts:</span> <strong>${info.hosts}</strong></div>
      <div><span style="color:var(--muted);display:inline-block;width:130px">CIDR:</span> <strong>${info.cidr}</strong></div>
      <div><span style="color:var(--muted);display:inline-block;width:130px">Netzklasse:</span> <strong>Klasse ${info.ipClass}</strong></div>
    </div>`;
}

function toggleSubnetCalc() {
  document.getElementById('subnet-panel').classList.toggle('open');
}

// ════════════════════════════════════════════════════════════
// GRID SNAP
// ════════════════════════════════════════════════════════════
let gridSnap = false;
const GRID = 25;

function toggleGridSnap() {
  gridSnap = !gridSnap;
  document.getElementById('btn-snap').classList.toggle('active', gridSnap);
  notify(gridSnap ? '⊞ Gitter-Snap AN (25px)' : '⊞ Gitter-Snap AUS', 'info');
}

// Intercept node movement to snap to grid
const _origCvMouseMove = cvMouseMove;
window.cvMouseMove = function(e) {
  if (dragNode && gridSnap) {
    const area = document.getElementById('canvas-area');
    const rect = area.getBoundingClientRect();
    const wx = Math.round(((e.clientX - rect.left - panX) / zoom - dragOff.x) / GRID) * GRID;
    const wy = Math.round(((e.clientY - rect.top - panY) / zoom - dragOff.y) / GRID) * GRID;
    dragNode.x = Math.max(40, Math.min(area.clientWidth / zoom - 40, wx));
    dragNode.y = Math.max(40, Math.min(area.clientHeight / zoom - 40, wy));
    dragNode.el.style.left = dragNode.x + 'px';
    dragNode.el.style.top = dragNode.y + 'px';
    draw(); return;
  }
  _origCvMouseMove(e);
};

// ════════════════════════════════════════════════════════════
// EXPORT AS PNG
// ════════════════════════════════════════════════════════════
function exportPNG() {
  // Render cables on canvas (already there), then merge with device layer screenshot
  const area = document.getElementById('canvas-area');
  const cvs2 = document.createElement('canvas');
  cvs2.width = area.clientWidth;
  cvs2.height = area.clientHeight;
  const cx2 = cvs2.getContext('2d');

  // Fill background
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  cx2.fillStyle = bg || '#E9E5DD';
  cx2.fillRect(0, 0, cvs2.width, cvs2.height);

  // Draw the main canvas (cables) onto cvs2
  cx2.drawImage(cvs, 0, 0);

  // Draw device nodes as rectangles with labels
  nodes.forEach(n => {
    const ex = n.x * zoom + panX;
    const ey = n.y * zoom + panY;
    if (ex < -60 || ex > cvs2.width + 60 || ey < -60 || ey > cvs2.height + 60) return;

    cx2.save();
    // Node bg circle
    cx2.beginPath();
    cx2.arc(ex, ey, 26 * zoom, 0, Math.PI * 2);
    cx2.fillStyle = TYPES[n.type]?.bgColor || '#f0f0f0';
    cx2.strokeStyle = TYPES[n.type]?.color || '#888';
    cx2.lineWidth = 2 * zoom;
    cx2.fill(); cx2.stroke();

    // Device name
    cx2.fillStyle = '#333';
    cx2.font = `${Math.max(9, 11 * zoom)}px Nunito,sans-serif`;
    cx2.textAlign = 'center';
    cx2.fillText(n.name, ex, ey + 38 * zoom);
    if (n.ip) {
      cx2.fillStyle = '#666';
      cx2.font = `${Math.max(7, 9 * zoom)}px monospace`;
      cx2.fillText(n.ip, ex, ey + 50 * zoom);
    }
    cx2.restore();
  });

  // Save
  cvs2.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'netzwerk.png';
    a.click();
    notify('📷 Netzwerk als PNG exportiert', 'success');
    log('Netzwerk als netzwerk.png gespeichert', 'ok');
  }, 'image/png');
}

// ════════════════════════════════════════════════════════════
// HUB BROADCAST VISUALIZATION
// ════════════════════════════════════════════════════════════
function animateHubBroadcast(hub, fromNode, color) {
  const hubNeighbors = neighbors(hub).filter(n => n.on && n.id !== fromNode.id);
  hubNeighbors.forEach((nb, i) => {
    setTimeout(() => {
      const path = [hub, nb];
      animatePkt(path, color || '#e91e63');
    }, i * 80);
  });
  if (captureActive) {
    addCapture('ETH', `Hub ${hub.name} Broadcast → ${hubNeighbors.length} Ports`);
  }
}

// Modified findPath to handle hub broadcast logging
const _origFindPath = findPath;
window.findPathWithHubLog = function(src, dstIP) {
  const path = _origFindPath(src, dstIP);
  if (path) {
    const hasHub = path.some(n => n.type === 'hub');
    if (hasHub && captureActive) {
      addCapture('ETH', `Paket via Hub (Broadcast-Domäne!): ${src.ip} → ${dstIP}`);
    }
  }
  return path;
};

// ════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS — add G for grid snap, N for subnet calc
// ════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') return;
  if (e.key === 'g' || e.key === 'G') toggleGridSnap();
  if (e.key === 'n' || e.key === 'N') toggleSubnetCalc();
}, true);

// WiFi animation loop for AP devices
function apAnimLoop() {
  if (nodes.some(n => n.type === 'ap' && n.on)) draw();
  requestAnimationFrame(apAnimLoop);
}
// Start AP animation after short delay to avoid conflicts
setTimeout(apAnimLoop, 2000);
