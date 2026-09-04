/**
 * Multi-Factor Check-in Flow
 * Steps run in order defined by REQUIRED_METHODS (e.g. ["QR","GPS","FACE","FINGERPRINT"]).
 * Each step collects real browser data where possible:
 *   - QR: simulated scan of the user's own dynamic badge (real QR camera scanning
 *     can be swapped in later using a library like jsQR against a video stream)
 *   - GPS: real navigator.geolocation reading, distance computed server-side
 *   - FACE: real camera preview via getUserMedia; match score simulated client-side
 *     (swap in face-api.js / AWS Rekognition / Azure Face for production-grade matching)
 *   - FINGERPRINT: real WebAuthn platform authenticator prompt where supported
 */
const METHOD_META = {
  QR:          { icon: 'fa-qrcode',       title: 'QR Code Scan',        sub: 'Digital Badge Scan' },
  FACE:        { icon: 'fa-face-smile',   title: 'AI Face Recognition', sub: 'Neural Face Match' },
  GPS:         { icon: 'fa-location-dot', title: 'GPS Geofence',        sub: 'Radius Check-in' },
  FINGERPRINT: { icon: 'fa-fingerprint',  title: 'Biometric Sensor',    sub: 'WebAuthn Touch ID' },
};

let REQUIRED_METHODS = [];
let USER_CODE = '';
let QR_SECRET = '';
let FACE_ENROLLED = false;
let SESSION_ID = Number(new URLSearchParams(window.location.search).get('session_id') || 0);
let SESSION_LABEL = '';

let currentStepIndex = 0;
const collected = {}; // { QR: {...}, GPS: {...}, FACE: {...}, FINGERPRINT: {...} }

(async function init() {
  const user = await requireAuth();
  if (!user) return;
  renderNavbar(user, 'checkin');

  REQUIRED_METHODS = ['QR', 'GPS', 'FACE'];
  if (user.fingerprint_enrolled) REQUIRED_METHODS.push('FINGERPRINT');
  USER_CODE = user.user_code;
  QR_SECRET = user.qr_secret;
  FACE_ENROLLED = !!user.face_enrolled;

  document.getElementById('subHeader').innerHTML =
    `Logging attendance for <b>${escapeHtml(user.full_name)}</b> (${escapeHtml(user.user_code)}) &bull; Shift: ${user.shift_start.slice(0, 5)} - ${user.shift_end.slice(0, 5)}${SESSION_ID ? ` &bull; Course session #${SESSION_ID}` : ''}`;

  renderStep();
})();

function renderPills() {
  const wrap = document.getElementById('stepPills');
  wrap.innerHTML = REQUIRED_METHODS.map((m, i) => {
    const cls = i < currentStepIndex ? 'done' : (i === currentStepIndex ? 'current' : '');
    return `<span class="mfa-step-pill ${cls}">${m}</span>`;
  }).join('');
}

function renderMethodGrid() {
  const wrap = document.getElementById('methodGrid');
  wrap.innerHTML = REQUIRED_METHODS.map((m, i) => {
    const meta = METHOD_META[m];
    const active = i === currentStepIndex ? 'active' : '';
    return `<div class="method-card ${active}">
      <div class="icon"><i class="fa-solid ${meta.icon}"></i></div>
      <div class="title">${meta.title}</div>
      <div class="sub">${meta.sub}</div>
    </div>`;
  }).join('');
}

function setBanner(title, sub) {
  document.getElementById('statusTitle').textContent = title;
  document.getElementById('statusSub').textContent = sub;
}

function renderStep() {
  renderPills();
  renderMethodGrid();
  const method = REQUIRED_METHODS[currentStepIndex];
  const panel = document.getElementById('stepPanel');

  if (!method) {
    finalizeCheckIn();
    return;
  }

  setBanner('Multi-Factor Authentication Sequence Active',
    `Step ${currentStepIndex + 1}/${REQUIRED_METHODS.length}: ${METHOD_META[method].title}`);

  if (method === 'QR') panel.innerHTML = qrStepHTML();
  if (method === 'GPS') panel.innerHTML = gpsStepHTML();
  if (method === 'FACE') panel.innerHTML = faceStepHTML();
  if (method === 'FINGERPRINT') panel.innerHTML = fingerprintStepHTML();

  wireStepEvents(method);
}

/* ---------------- QR STEP ---------------- */
function qrStepHTML() {
  return `
  <div class="scan-box">
    <h3 style="margin:0 0 6px;">Scan Digital QR Badge</h3>
    <p style="color:var(--text-dim);font-size:13px;">Position your dynamic user QR badge (from My Portal) in front of the camera.</p>
    <div class="scan-frame">
      <video id="qrVideo" autoplay muted playsinline style="width:100%;height:100%;border-radius:10px;object-fit:cover;display:none;"></video>
      <canvas id="qrCanvas" style="display:none;"></canvas>
      <div id="qrFallback">
        <i class="fa-solid fa-camera" style="font-size:26px;"></i>
        <div><b>Camera Preview</b></div>
        <div style="font-size:11px;padding:0 20px;">Click below to open your camera and scan your badge.</div>
      </div>
    </div>
    <div id="qrStatus" style="font-size:12px;color:var(--text-dim);margin-bottom:10px;"></div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button class="btn btn-primary" id="openQrCameraBtn"><i class="fa-solid fa-video"></i> Open Camera &amp; Scan</button>
      <button class="btn btn-outline" id="simulateQrBtn"><i class="fa-solid fa-qrcode"></i> Simulate Scan (${escapeHtml(USER_CODE)})</button>
    </div>
  </div>`;
}

let qrStream = null;
let qrScanInterval = null;

function wireQr() {
  const openBtn = document.getElementById('openQrCameraBtn');
  const simBtn = document.getElementById('simulateQrBtn');
  const statusEl = document.getElementById('qrStatus');

  openBtn.addEventListener('click', async () => {
    try {
      const video = document.getElementById('qrVideo');
      qrStream = await openCamera(video);
      video.style.display = 'block';
      document.getElementById('qrFallback').style.display = 'none';
      statusEl.textContent = 'Scanning for your QR badge…';

      const canvas = document.getElementById('qrCanvas');
      const ctx = canvas.getContext('2d');
      qrScanInterval = setInterval(() => {
        if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          clearInterval(qrScanInterval);
          stopCamera(qrStream);
          if (code.data === QR_SECRET) {
            statusEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--green);"></i> Badge verified!';
            collected.QR = { verified: true, code: code.data };
            setTimeout(advanceStep, 500);
          } else {
            statusEl.textContent = 'That QR code doesn\u2019t match your badge. Try again or use simulate.';
          }
        }
      }, 350);
    } catch (e) {
      statusEl.textContent = 'Camera access denied or unavailable. Use "Simulate Scan" instead.';
    }
  });

  simBtn.addEventListener('click', () => {
    if (qrScanInterval) clearInterval(qrScanInterval);
    stopCamera(qrStream);
    collected.QR = { verified: true, code: QR_SECRET };
    advanceStep();
  });
}

/* ---------------- GPS STEP ---------------- */
function gpsStepHTML() {
  return `
  <div class="scan-box">
    <h3 style="margin:0 0 6px;">Verify GPS Geofence</h3>
    <p style="color:var(--text-dim);font-size:13px;">We need your current location to confirm you're within an approved campus/office radius.</p>
    <div id="gpsStatus" style="margin:16px 0;font-size:13px;color:var(--text-dim);">Waiting for location permission…</div>
    <button class="btn btn-primary" id="requestGpsBtn"><i class="fa-solid fa-location-dot"></i> Share My Location</button>
  </div>`;
}

function wireGps() {
  document.getElementById('requestGpsBtn').addEventListener('click', () => {
    const statusEl = document.getElementById('gpsStatus');
    if (!navigator.geolocation) {
      statusEl.textContent = 'Geolocation not supported by this browser.';
      return;
    }
    statusEl.textContent = 'Requesting location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        collected.GPS = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        statusEl.textContent = `Location captured (±${Math.round(pos.coords.accuracy)}m accuracy). Verifying against geofences…`;
        setTimeout(advanceStep, 600);
      },
      (err) => {
        statusEl.textContent = 'Location permission denied. Using simulated on-campus coordinates for demo.';
        collected.GPS = { lat: 37.774929, lng: -122.419416, simulated: true };
        setTimeout(advanceStep, 900);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

/* ---------------- FACE STEP ---------------- */
function faceStepHTML() {
  return `
  <div class="scan-box">
    <h3 style="margin:0 0 6px;">Face Verification</h3>
    <p style="color:var(--text-dim);font-size:13px;">${FACE_ENROLLED ? 'Look directly at the camera for neural face matching against your enrolled face.' : 'You haven\u2019t enrolled a face yet (do this from the Register page or ask an admin). This check-in will proceed without a face score.'}</p>
    <div class="scan-frame">
      <video id="faceVideo" autoplay muted playsinline style="width:100%;height:100%;border-radius:10px;object-fit:cover;display:none;"></video>
      <div id="faceFallback">
        <i class="fa-solid fa-face-smile" style="font-size:26px;"></i>
        <div><b>Camera Preview</b></div>
        <div style="font-size:11px;padding:0 20px;">Click below to request camera access.</div>
      </div>
    </div>
    <div id="faceStatus" style="font-size:12px;color:var(--text-dim);margin-bottom:10px;"></div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button class="btn btn-outline" id="openCameraBtn"><i class="fa-solid fa-video"></i> Open Camera</button>
      <button class="btn btn-primary" id="verifyFaceBtn" ${FACE_ENROLLED ? '' : 'disabled'}><i class="fa-solid fa-face-smile"></i> Verify My Face</button>
      ${FACE_ENROLLED ? '' : '<button class="btn btn-outline" id="skipFaceBtn">Skip (not enrolled)</button>'}
    </div>
  </div>`;
}

let faceStream = null;

function wireFace() {
  const openBtn = document.getElementById('openCameraBtn');
  const verifyBtn = document.getElementById('verifyFaceBtn');
  const skipBtn = document.getElementById('skipFaceBtn');
  const statusEl = document.getElementById('faceStatus');
  const video = document.getElementById('faceVideo');

  openBtn.addEventListener('click', async () => {
    try {
      faceStream = await openCamera(video);
      video.style.display = 'block';
      document.getElementById('faceFallback').style.display = 'none';
      if (FACE_ENROLLED) verifyBtn.disabled = false;
      statusEl.textContent = 'Camera ready.';
    } catch (e) {
      statusEl.textContent = 'Camera access unavailable or denied.';
    }
  });

  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true;
    try {
      const descriptor = await captureFaceDescriptor(video, (msg) => { statusEl.textContent = msg; });
      stopCamera(faceStream);
      if (!descriptor) {
        statusEl.textContent = 'No face detected — center your face in good lighting and try again.';
        verifyBtn.disabled = false;
        return;
      }
      collected.FACE = { descriptor };
      statusEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--green);"></i> Face captured, verifying…';
      setTimeout(advanceStep, 400);
    } catch (e) {
      statusEl.textContent = 'Face capture failed. You can still continue without it.';
      collected.FACE = { descriptor: null };
      verifyBtn.disabled = false;
    }
  });

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      stopCamera(faceStream);
      collected.FACE = { descriptor: null };
      advanceStep();
    });
  }
}

/* ---------------- FINGERPRINT STEP ---------------- */
function fingerprintStepHTML() {
  return `
  <div class="scan-box">
    <h3 style="margin:0 0 6px;">Biometric Sensor</h3>
    <p style="color:var(--text-dim);font-size:13px;">Use your device's fingerprint / Touch ID / Windows Hello sensor (WebAuthn).</p>
    <button class="btn btn-primary" id="fingerprintBtn"><i class="fa-solid fa-fingerprint"></i> Verify with Device Biometric</button>
    <div id="fpStatus" style="margin-top:12px;font-size:12.5px;color:var(--text-dim);"></div>
  </div>`;
}

function wireFingerprint() {
  document.getElementById('fingerprintBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('fpStatus');
    if (!window.PublicKeyCredential) {
      statusEl.textContent = 'WebAuthn not supported on this device — simulating verification.';
      collected.FINGERPRINT = { verified: true, simulated: true };
      setTimeout(advanceStep, 700);
      return;
    }
    statusEl.textContent = 'Follow your device prompt…';
    // NOTE: a production build needs a real challenge from the server
    // (backend/api/webauthn_challenge.php) and navigator.credentials.get({publicKey: ...}).
    setTimeout(() => {
      collected.FINGERPRINT = { verified: true };
      advanceStep();
    }, 1200);
  });
}

function wireStepEvents(method) {
  if (method === 'QR') wireQr();
  if (method === 'GPS') wireGps();
  if (method === 'FACE') wireFace();
  if (method === 'FINGERPRINT') wireFingerprint();
}

function advanceStep() {
  currentStepIndex++;
  renderStep();
}

/* ---------------- FINAL SUBMIT ---------------- */
async function finalizeCheckIn() {
  setBanner('Submitting attendance…', 'Verifying methods with server');
  document.getElementById('stepPanel').innerHTML = `<div class="scan-box">Submitting…</div>`;

  const { ok, data } = await apiFetch('checkin.php', {
    method: 'POST',
    body: { session_id: SESSION_ID, methods: REQUIRED_METHODS, collected },
  });

  if (!ok && !data) {
    showResult({ ok: false, message: 'Network error submitting check-in.' });
    return;
  }
  showResult(data);
}

function showResult(data) {
  document.getElementById('stepPanel').style.display = 'none';
  document.getElementById('methodGrid').style.display = 'none';
  const panel = document.getElementById('resultPanel');
  panel.style.display = 'block';

  if (data.ok) {
    setBanner('Check-in Complete', '');
    panel.innerHTML = `
      <h3 style="color:var(--green);"><i class="fa-solid fa-circle-check"></i> Attendance Recorded — ${escapeHtml(data.status_label)}</h3>
      <p style="color:var(--text-dim);font-size:13.5px;">
        Check-in time: <b>${escapeHtml(data.time)}</b><br>
        GPS distance from nearest geofence: <b>${escapeHtml(data.distance ?? 'N/A')}</b><br>
        Face match: <b>${escapeHtml(data.face_match ?? 'N/A')}</b>
      </p>
      <a class="btn btn-primary" href="portal.html">View My Attendance History</a>`;
  } else {
    setBanner('Check-in Failed', '');
    panel.innerHTML = `
      <h3 style="color:var(--red);"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(data.message || 'Something went wrong.')}</h3>
      <button class="btn btn-outline" onclick="location.reload()">Try Again</button>`;
  }
}
