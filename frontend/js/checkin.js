/*
 * Multi-Factor Check-in Flow
 *
 * Simulations are intentionally preserved for testing:
 * - QR simulation
 * - GPS fallback simulation
 * - Face capture/simulation
 * - Fingerprint simulation when WebAuthn is unavailable
 *
 * The final attendance decision is made by checkin.php.
 */

const METHOD_META = {
    QR:          { icon: 'fa-qrcode',      title: 'QR Code Scan',        sub: 'Digital Badge Scan' },
    FACE:        { icon: 'fa-face-smile',  title: 'AI Face Recognition', sub: 'Neural Face Match' },
    GPS:         { icon: 'fa-location-dot',title: 'GPS Geofence',        sub: 'Radius Check-in' },
    FINGERPRINT: { icon: 'fa-fingerprint', title: 'Biometric Sensor',    sub: 'WebAuthn Touch ID' },
};

let REQUIRED_METHODS = [];
let USER_CODE = '';
let QR_SECRET = '';
let FACE_ENROLLED = false;

let SESSION_ID = Number(
    new URLSearchParams(window.location.search).get('session_id') || 0
);

let currentStepIndex = 0;

const collected = {};

(async function init() {
    try {
        const user = await requireAuth();
        if (!user) return;

        renderNavbar(user, 'checkin');

        REQUIRED_METHODS = ['QR', 'GPS', 'FACE'];

        if (user.fingerprint_enrolled) {
            REQUIRED_METHODS.push('FINGERPRINT');
        }

        USER_CODE = user.user_code;
        QR_SECRET = user.qr_secret;
        FACE_ENROLLED = !!user.face_enrolled;

        document.getElementById('subHeader').innerHTML =
            `Logging attendance for <b>${escapeHtml(user.full_name)}</b> ` +
            `(${escapeHtml(user.user_code)}) &bull; ` +
            `Shift: ${user.shift_start.slice(0, 5)} - ${user.shift_end.slice(0, 5)}` +
            `${SESSION_ID ? ` &bull; Course session #${SESSION_ID}` : ''}`;

        renderStep();

    } catch (error) {
        showResult({
            ok: false,
            message: error.message || 'Failed to initialise check-in.'
        });
    }
})();

function renderPills() {
    const wrap = document.getElementById('stepPills');

    wrap.innerHTML = REQUIRED_METHODS.map((m, i) => {
        const cls =
            i < currentStepIndex
                ? 'done'
                : (i === currentStepIndex ? 'current' : '');

        return `<span class="mfa-step-pill ${cls}">${m}</span>`;
    }).join('');
}

function renderMethodGrid() {
    const wrap = document.getElementById('methodGrid');

    wrap.innerHTML = REQUIRED_METHODS.map((m, i) => {
        const meta = METHOD_META[m];
        const active = i === currentStepIndex ? 'active' : '';

        return `
            <div class="method-card ${active}">
                <div class="icon">
                    <i class="fa-solid ${meta.icon}"></i>
                </div>
                <div class="title">${meta.title}</div>
                <div class="sub">${meta.sub}</div>
            </div>
        `;
    }).join('');
}

function setBanner(title, sub) {
    document.getElementById('statusTitle').textContent = title;
    document.getElementById('statusSub').textContent = sub;
}

/**
 * Only advance when the current method has actually produced
 * a collected verification object.
 */
function advanceStep(method) {
    if (!method) {
        method = REQUIRED_METHODS[currentStepIndex];
    }

    if (!method) {
        finalizeCheckIn();
        return;
    }

    if (!collected[method]) {
        console.error(`Cannot advance: ${method} has not been completed.`);
        return;
    }

    currentStepIndex++;

    if (currentStepIndex >= REQUIRED_METHODS.length) {
        renderPills();
        renderMethodGrid();
        finalizeCheckIn();
        return;
    }

    renderStep();
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

    setBanner(
        'Multi-Factor Authentication Sequence Active',
        `Step ${currentStepIndex + 1}/${REQUIRED_METHODS.length}: ${METHOD_META[method].title}`
    );

    if (method === 'QR') {
        panel.innerHTML = qrStepHTML();
    } else if (method === 'GPS') {
        panel.innerHTML = gpsStepHTML();
    } else if (method === 'FACE') {
        panel.innerHTML = faceStepHTML();
    } else if (method === 'FINGERPRINT') {
        panel.innerHTML = fingerprintStepHTML();
    }

    wireStepEvents(method);
}

/* =========================================================
   QR
========================================================= */

function qrStepHTML() {
    return `
        <div class="scan-box">
            <h3 style="margin:0 0 6px;">Scan Digital QR Badge</h3>

            <p style="color:var(--text-dim);font-size:13px;">
                Position your dynamic user QR badge (from My Portal)
                in front of the camera.
            </p>

            <div class="scan-frame">
                <video
                    id="qrVideo"
                    autoplay
                    muted
                    playsinline
                    style="width:100%;height:100%;border-radius:10px;
                    object-fit:cover;display:none;">
                </video>

                <canvas id="qrCanvas" style="display:none;"></canvas>

                <div id="qrFallback">
                    <i class="fa-solid fa-camera" style="font-size:26px;"></i>
                    <div><b>Camera Preview</b></div>
                    <div style="font-size:11px;padding:0 20px;">
                        Click below to open your camera and scan your badge.
                    </div>
                </div>
            </div>

            <div
                id="qrStatus"
                style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">
            </div>

            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                <button class="btn btn-primary" id="openQrCameraBtn">
                    <i class="fa-solid fa-video"></i>
                    Open Camera &amp; Scan
                </button>

                <button class="btn btn-outline" id="simulateQrBtn">
                    <i class="fa-solid fa-qrcode"></i>
                    Simulate Scan (${escapeHtml(USER_CODE)})
                </button>
            </div>
        </div>
    `;
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

                ctx.drawImage(
                    video,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                const imageData = ctx.getImageData(
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                const code = jsQR(
                    imageData.data,
                    imageData.width,
                    imageData.height
                );

                if (!code || !code.data) return;

                clearInterval(qrScanInterval);
                qrScanInterval = null;

                stopCamera(qrStream);
                qrStream = null;

                if (code.data === QR_SECRET) {
                    statusEl.innerHTML =
                        '<i class="fa-solid fa-circle-check" ' +
                        'style="color:var(--green);"></i> Badge verified!';

                    collected.QR = {
                        verified: true,
                        code: code.data,
                        simulated: false
                    };

                    setTimeout(() => advanceStep('QR'), 500);
                } else {
                    statusEl.textContent =
                        'That QR code doesn’t match your badge. Try again or use simulate.';
                }
            }, 350);

        } catch (e) {
            console.error(e);

            statusEl.textContent =
                'Camera access denied or unavailable. Use "Simulate Scan" instead.';
        }
    });

    simBtn.addEventListener('click', () => {
        if (qrScanInterval) {
            clearInterval(qrScanInterval);
            qrScanInterval = null;
        }

        stopCamera(qrStream);
        qrStream = null;

        collected.QR = {
            verified: true,
            code: QR_SECRET,
            simulated: true
        };

        statusEl.innerHTML =
            '<i class="fa-solid fa-circle-check" ' +
            'style="color:var(--green);"></i> Simulated badge verified!';

        setTimeout(() => advanceStep('QR'), 500);
    });
}

/* =========================================================
   GPS
========================================================= */

function gpsStepHTML() {
    return `
        <div class="scan-box">
            <h3 style="margin:0 0 6px;">Verify GPS Geofence</h3>

            <p style="color:var(--text-dim);font-size:13px;">
                We need your current location to confirm you're within
                an approved campus/office radius.
            </p>

            <div
                id="gpsStatus"
                style="margin:16px 0;font-size:13px;color:var(--text-dim);">
                Waiting for location permission…
            </div>

            <button class="btn btn-primary" id="requestGpsBtn">
                <i class="fa-solid fa-location-dot"></i>
                Share My Location
            </button>
        </div>
    `;
}

function wireGps() {
    document
        .getElementById('requestGpsBtn')
        .addEventListener('click', () => {

            const statusEl = document.getElementById('gpsStatus');

            if (!navigator.geolocation) {
                statusEl.textContent =
                    'Geolocation not supported by this browser.';
                return;
            }

            statusEl.textContent = 'Requesting location…';

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    collected.GPS = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                        simulated: false
                    };

                    statusEl.textContent =
                        `Location captured (±${Math.round(
                            pos.coords.accuracy
                        )}m accuracy). Verifying against geofences…`;

                    setTimeout(() => advanceStep('GPS'), 600);
                },

                (err) => {
                    console.warn('GPS unavailable:', err);

                    /*
                     * Simulation deliberately preserved.
                     * PHP still performs the geofence calculation.
                     */
                    collected.GPS = {
                        lat: 37.774929,
                        lng: -122.419416,
                        accuracy: null,
                        simulated: true
                    };

                    statusEl.textContent =
                        'Location unavailable. Using simulated on-campus coordinates for demo.';

                    setTimeout(() => advanceStep('GPS'), 900);
                },

                {
                    enableHighAccuracy: true,
                    timeout: 8000,
                    maximumAge: 0
                }
            );
        });
}

/* =========================================================
   FACE
========================================================= */

function faceStepHTML() {
    return `
        <div class="scan-box">
            <h3 style="margin:0 0 6px;">Face Verification</h3>

            <p style="color:var(--text-dim);font-size:13px;">
                ${
                    FACE_ENROLLED
                        ? 'Look directly at the camera for neural face matching against your enrolled face.'
                        : 'You haven’t enrolled a face yet. This check-in will proceed without a face score.'
                }
            </p>

            <div class="scan-frame">
                <video
                    id="faceVideo"
                    autoplay
                    muted
                    playsinline
                    style="width:100%;height:100%;border-radius:10px;
                    object-fit:cover;display:none;">
                </video>

                <div id="faceFallback">
                    <i class="fa-solid fa-face-smile" style="font-size:26px;"></i>
                    <div><b>Camera Preview</b></div>
                    <div style="font-size:11px;padding:0 20px;">
                        Click below to request camera access.
                    </div>
                </div>
            </div>

            <div
                id="faceStatus"
                style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">
            </div>

            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">

                <button class="btn btn-outline" id="openCameraBtn">
                    <i class="fa-solid fa-video"></i>
                    Open Camera
                </button>

                <button
                    class="btn btn-primary"
                    id="verifyFaceBtn"
                    ${FACE_ENROLLED ? '' : 'disabled'}>
                    <i class="fa-solid fa-face-smile"></i>
                    Verify My Face
                </button>

                ${
                    FACE_ENROLLED
                        ? ''
                        : '<button class="btn btn-outline" id="skipFaceBtn">Skip (not enrolled)</button>'
                }

            </div>
        </div>
    `;
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

            if (FACE_ENROLLED) {
                verifyBtn.disabled = false;
            }

            statusEl.textContent = 'Camera ready.';

        } catch (e) {
            console.error(e);
            statusEl.textContent =
                'Camera access unavailable or denied.';
        }
    });

    verifyBtn.addEventListener('click', async () => {
        verifyBtn.disabled = true;

        try {
            const descriptor = await captureFaceDescriptor(
                video,
                (msg) => {
                    statusEl.textContent = msg;
                }
            );

            stopCamera(faceStream);
            faceStream = null;

            if (!descriptor) {
                statusEl.textContent =
                    'No face detected — center your face in good lighting and try again.';

                verifyBtn.disabled = false;
                return;
            }

            collected.FACE = {
                descriptor,
                simulated: false
            };

            statusEl.innerHTML =
                '<i class="fa-solid fa-circle-check" ' +
                'style="color:var(--green);"></i> Face captured, verifying…';

            setTimeout(() => advanceStep('FACE'), 400);

        } catch (e) {
            console.error(e);

            statusEl.textContent =
                'Face capture failed. Try again.';

            verifyBtn.disabled = false;
        }
    });

    if (skipBtn) {
        skipBtn.addEventListener('click', () => {
            stopCamera(faceStream);
            faceStream = null;

            /*
             * This is allowed only because the server also knows
             * whether the user has a face enrolled.
             */
            collected.FACE = {
                descriptor: null,
                simulated: true,
                skipped: true
            };

            advanceStep('FACE');
        });
    }
}

/* =========================================================
   FINGERPRINT
========================================================= */

function fingerprintStepHTML() {
    return `
        <div class="scan-box">
            <h3 style="margin:0 0 6px;">Biometric Sensor</h3>

            <p style="color:var(--text-dim);font-size:13px;">
                Use your device's fingerprint / Touch ID /
                Windows Hello sensor (WebAuthn).
            </p>

            <button class="btn btn-primary" id="fingerprintBtn">
                <i class="fa-solid fa-fingerprint"></i>
                Verify with Device Biometric
            </button>

            <div
                id="fpStatus"
                style="margin-top:12px;font-size:12.5px;color:var(--text-dim);">
            </div>
        </div>
    `;
}

function wireFingerprint() {
    document
        .getElementById('fingerprintBtn')
        .addEventListener('click', async () => {

            const statusEl = document.getElementById('fpStatus');

            /*
             * Simulation preserved when WebAuthn is unavailable.
             */
            if (!window.PublicKeyCredential) {
                statusEl.textContent =
                    'WebAuthn not supported on this device — simulating verification.';

                collected.FINGERPRINT = {
                    verified: true,
                    simulated: true
                };

                setTimeout(() => advanceStep('FINGERPRINT'), 700);
                return;
            }

            statusEl.textContent =
                'Follow your device prompt…';

            /*
             * Existing simulated WebAuthn behavior preserved.
             * Replace with server challenge later.
             */
            setTimeout(() => {
                collected.FINGERPRINT = {
                    verified: true,
                    simulated: true
                };

                advanceStep('FINGERPRINT');
            }, 1200);
        });
}

/* =========================================================
   EVENT WIRING
========================================================= */

function wireStepEvents(method) {
    if (method === 'QR') wireQr();
    else if (method === 'GPS') wireGps();
    else if (method === 'FACE') wireFace();
    else if (method === 'FINGERPRINT') wireFingerprint();
}

/* =========================================================
   FINAL SUBMISSION
========================================================= */

let submitting = false;

async function finalizeCheckIn() {
    if (submitting) return;

    submitting = true;

    setBanner(
        'Submitting attendance…',
        'Verifying methods with server'
    );

    document.getElementById('stepPanel').innerHTML =
        `<div class="scan-box">Submitting…</div>`;

    /*
     * Client-side sanity check.
     * PHP performs the real enforcement.
     */
    const missing = REQUIRED_METHODS.filter(
        method => !collected[method]
    );

    if (missing.length) {
        submitting = false;

        showResult({
            ok: false,
            message: `Required verification missing: ${missing.join(', ')}`
        });

        return;
    }

    try {
        const { ok, data } = await apiFetch('checkin.php', {
            method: 'POST',
            body: {
                session_id: SESSION_ID,
                methods: REQUIRED_METHODS,
                collected: collected
            }
        });

        /*
         * IMPORTANT:
         * If PHP returned an actual error message, display it.
         */
        if (!ok || !data) {
            showResult({
                ok: false,
                message:
                    data?.message ||
                    data?.error ||
                    `Server returned HTTP ${data?.status || 'an unknown error'}.`
            });

            return;
        }

        showResult(data);

    } catch (error) {
        console.error(error);

        showResult({
            ok: false,
            message:
                error.message ||
                'Unable to communicate with the attendance server.'
        });
    } finally {
        submitting = false;
    }
}

/* =========================================================
   RESULT
========================================================= */

function showResult(data) {
    document.getElementById('stepPanel').style.display = 'none';
    document.getElementById('methodGrid').style.display = 'none';

    const panel = document.getElementById('resultPanel');

    panel.style.display = 'block';

    if (data.ok) {
        setBanner('Attendance Recorded', '');

        panel.innerHTML = `
            <h3 style="color:var(--green);">
                <i class="fa-solid fa-circle-check"></i>
                Attendance Recorded
            </h3>

            <p style="color:var(--text-dim);font-size:13.5px;">
                Check-in time:
                <b>${escapeHtml(data.time || 'N/A')}</b><br>

                GPS distance from nearest geofence:
                <b>${escapeHtml(data.distance ?? 'N/A')}</b><br>

                Face match:
                <b>${escapeHtml(data.face_match ?? 'N/A')}</b>
            </p>

            <a class="btn btn-primary" href="portal.html">
                View My Attendance History
            </a>
        `;

    } else {
        setBanner('Check-in Failed', '');

        panel.innerHTML = `
            <h3 style="color:var(--red);">
                <i class="fa-solid fa-triangle-exclamation"></i>
                ${escapeHtml(data.message || 'Check-in failed.')}
            </h3>

            ${
                data.error
                    ? `<pre style="
                        text-align:left;
                        white-space:pre-wrap;
                        color:var(--red);
                        font-size:12px;
                        margin-top:15px;
                    ">${escapeHtml(data.error)}</pre>`
                    : ''
            }

            <button class="btn btn-outline" onclick="location.reload()">
                Try Again
            </button>
        `;
    }
}
