js
/**
 * Multi-Factor Check-in Flow
 *
 * Required sequence:
 * QR → GPS → FACE → FINGERPRINT (if enrolled)
 *
 * SIMULATION:
 * - QR has a Simulate Scan button for testing.
 * - GPS falls back to simulated coordinates if permission fails.
 * - FACE uses the existing captureFaceDescriptor() implementation.
 * - FINGERPRINT currently simulates success because real WebAuthn
 *   challenge/verification has not been connected yet.
 */

const METHOD_META = {
    QR: {
        icon: 'fa-qrcode',
        title: 'QR Code Scan',
        sub: 'Digital Badge Scan'
    },

    FACE: {
        icon: 'fa-face-smile',
        title: 'AI Face Recognition',
        sub: 'Neural Face Match'
    },

    GPS: {
        icon: 'fa-location-dot',
        title: 'GPS Geofence',
        sub: 'Radius Check-in'
    },

    FINGERPRINT: {
        icon: 'fa-fingerprint',
        title: 'Biometric Sensor',
        sub: 'WebAuthn Touch ID'
    }
};

let REQUIRED_METHODS = [];
let USER_CODE = '';
let QR_SECRET = '';
let FACE_ENROLLED = false;

const SESSION_ID = Number(
    new URLSearchParams(window.location.search).get('session_id') || 0
);

let currentStepIndex = 0;

const collected = {};

let qrStream = null;
let qrScanInterval = null;
let faceStream = null;


/* =========================================================
   INITIALIZATION
   ========================================================= */

(async function init() {
    try {
        const user = await requireAuth();

        if (!user) {
            return;
        }

        renderNavbar(user, 'checkin');

        /*
         * These are the methods required by this check-in flow.
         * Fingerprint is added when the user has enrolled it.
         */
        REQUIRED_METHODS = ['QR', 'GPS', 'FACE'];

        if (user.fingerprint_enrolled) {
            REQUIRED_METHODS.push('FINGERPRINT');
        }

        USER_CODE = user.user_code || '';
        QR_SECRET = user.qr_secret || '';
        FACE_ENROLLED = !!user.face_enrolled;

        const subHeader = document.getElementById('subHeader');

        if (subHeader) {
            subHeader.innerHTML =
                `Logging attendance for <b>${escapeHtml(user.full_name || '')}</b> ` +
                `(${escapeHtml(user.user_code || '')}) &bull; ` +
                `Shift: ${(user.shift_start || '').slice(0, 5)} - ${(user.shift_end || '').slice(0, 5)}` +
                `${SESSION_ID ? ` &bull; Course session #${SESSION_ID}` : ''}`;
        }

        renderStep();

    } catch (error) {
        console.error('Check-in initialization error:', error);

        showResult({
            ok: false,
            message: 'Unable to initialize the check-in page.'
        });
    }
})();


/* =========================================================
   UI
   ========================================================= */

function renderPills() {
    const wrap = document.getElementById('stepPills');

    if (!wrap) return;

    wrap.innerHTML = REQUIRED_METHODS.map((method, index) => {
        const cls =
            index < currentStepIndex
                ? 'done'
                : index === currentStepIndex
                    ? 'current'
                    : '';

        return `
            <span class="mfa-step-pill ${cls}">
                ${escapeHtml(method)}
            </span>
        `;
    }).join('');
}


function renderMethodGrid() {
    const wrap = document.getElementById('methodGrid');

    if (!wrap) return;

    wrap.innerHTML = REQUIRED_METHODS.map((method, index) => {
        const meta = METHOD_META[method];

        if (!meta) return '';

        const active = index === currentStepIndex ? 'active' : '';

        return `
            <div class="method-card ${active}">
                <div class="icon">
                    <i class="fa-solid ${meta.icon}"></i>
                </div>

                <div class="title">
                    ${escapeHtml(meta.title)}
                </div>

                <div class="sub">
                    ${escapeHtml(meta.sub)}
                </div>
            </div>
        `;
    }).join('');
}


function setBanner(title, sub) {
    const titleEl = document.getElementById('statusTitle');
    const subEl = document.getElementById('statusSub');

    if (titleEl) {
        titleEl.textContent = title;
    }

    if (subEl) {
        subEl.textContent = sub;
    }
}


function renderStep() {
    renderPills();
    renderMethodGrid();

    const method = REQUIRED_METHODS[currentStepIndex];
    const panel = document.getElementById('stepPanel');

    if (!panel) return;

    if (!method) {
        finalizeCheckIn();
        return;
    }

    setBanner(
        'Multi-Factor Authentication Sequence Active',
        `Step ${currentStepIndex + 1}/${REQUIRED_METHODS.length}: ${METHOD_META[method].title}`
    );

    panel.style.display = 'block';

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

            <h3 style="margin:0 0 6px;">
                Scan Digital QR Badge
            </h3>

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
                    style="
                        width:100%;
                        height:100%;
                        border-radius:10px;
                        object-fit:cover;
                        display:none;
                    "
                ></video>

                <canvas id="qrCanvas" style="display:none;"></canvas>

                <div id="qrFallback">
                    <i class="fa-solid fa-camera" style="font-size:26px;"></i>

                    <div>
                        <b>Camera Preview</b>
                    </div>

                    <div style="font-size:11px;padding:0 20px;">
                        Click below to open your camera and scan your badge.
                    </div>
                </div>

            </div>

            <div
                id="qrStatus"
                style="
                    font-size:12px;
                    color:var(--text-dim);
                    margin-bottom:10px;
                "
            ></div>

            <div
                style="
                    display:flex;
                    gap:10px;
                    justify-content:center;
                    flex-wrap:wrap;
                "
            >
                <button class="btn btn-primary" id="openQrCameraBtn">
                    <i class="fa-solid fa-video"></i>
                    Open Camera &amp; Scan
                </button>

                <!-- KEEPING YOUR SIMULATION FOR TESTING -->
                <button class="btn btn-outline" id="simulateQrBtn">
                    <i class="fa-solid fa-qrcode"></i>
                    Simulate Scan (${escapeHtml(USER_CODE)})
                </button>
            </div>

        </div>
    `;
}


function wireQr() {
    const openBtn = document.getElementById('openQrCameraBtn');
    const simBtn = document.getElementById('simulateQrBtn');
    const statusEl = document.getElementById('qrStatus');

    if (!openBtn || !simBtn || !statusEl) return;

    openBtn.addEventListener('click', async () => {

        try {

            if (qrScanInterval) {
                clearInterval(qrScanInterval);
                qrScanInterval = null;
            }

            if (qrStream) {
                stopCamera(qrStream);
                qrStream = null;
            }

            const video = document.getElementById('qrVideo');

            qrStream = await openCamera(video);

            video.style.display = 'block';

            document.getElementById('qrFallback').style.display = 'none';

            statusEl.textContent = 'Scanning for your QR badge…';

            const canvas = document.getElementById('qrCanvas');
            const ctx = canvas.getContext('2d');

            qrScanInterval = setInterval(() => {

                if (
                    !video.videoWidth ||
                    !video.videoHeight ||
                    video.readyState < video.HAVE_CURRENT_DATA
                ) {
                    return;
                }

                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                ctx.drawImage(
                    video,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                try {

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

                    if (!code || !code.data) {
                        return;
                    }

                    /*
                     * Correct QR
                     */
                    if (code.data === QR_SECRET) {

                        clearInterval(qrScanInterval);
                        qrScanInterval = null;

                        stopCamera(qrStream);
                        qrStream = null;

                        statusEl.innerHTML =
                            '<i class="fa-solid fa-circle-check" ' +
                            'style="color:var(--green);"></i> ' +
                            'Badge verified!';

                        collected.QR = {
                            verified: true,
                            code: code.data,
                            simulated: false
                        };

                        setTimeout(advanceStep, 500);

                    } else {

                        /*
                         * Don't permanently kill the scan when the
                         * wrong QR is detected. Tell the user and keep
                         * scanning.
                         */
                        statusEl.textContent =
                            'That QR code does not match your badge. Keep scanning...';
                    }

                } catch (error) {
                    console.error('QR scan error:', error);
                }

            }, 350);

        } catch (error) {

            console.error('QR camera error:', error);

            statusEl.textContent =
                'Camera access denied or unavailable. Use "Simulate Scan" instead.';
        }
    });


    /*
     * INTENTIONAL SIMULATION
     */
    simBtn.addEventListener('click', () => {

        if (qrScanInterval) {
            clearInterval(qrScanInterval);
            qrScanInterval = null;
        }

        if (qrStream) {
            stopCamera(qrStream);
            qrStream = null;
        }

        collected.QR = {
            verified: true,
            code: QR_SECRET,
            simulated: true
        };

        advanceStep();
    });
}


/* =========================================================
   GPS
   ========================================================= */

function gpsStepHTML() {
    return `
        <div class="scan-box">

            <h3 style="margin:0 0 6px;">
                Verify GPS Geofence
            </h3>

            <p style="color:var(--text-dim);font-size:13px;">
                We need your current location to confirm you're within
                an approved campus/office radius.
            </p>

            <div
                id="gpsStatus"
                style="
                    margin:16px 0;
                    font-size:13px;
                    color:var(--text-dim);
                "
            >
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

    const btn = document.getElementById('requestGpsBtn');
    const statusEl = document.getElementById('gpsStatus');

    if (!btn || !statusEl) return;

    btn.addEventListener('click', () => {

        if (!navigator.geolocation) {

            statusEl.textContent =
                'Geolocation is not supported by this browser.';

            return;
        }

        btn.disabled = true;

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
                    `Location captured (±${Math.round(pos.coords.accuracy)}m accuracy). ` +
                    'Verifying against geofences…';

                setTimeout(advanceStep, 600);
            },

            (err) => {

                console.warn('GPS error:', err);

                /*
                 * INTENTIONAL SIMULATION
                 */
                statusEl.textContent =
                    'Location permission denied. Using simulated on-campus coordinates for demo.';

                collected.GPS = {
                    lat: 37.774929,
                    lng: -122.419416,
                    accuracy: 0,
                    simulated: true
                };

                setTimeout(advanceStep, 900);
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

            <h3 style="margin:0 0 6px;">
                Face Verification
            </h3>

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
                    style="
                        width:100%;
                        height:100%;
                        border-radius:10px;
                        object-fit:cover;
                        display:none;
                    "
                ></video>

                <div id="faceFallback">

                    <i
                        class="fa-solid fa-face-smile"
                        style="font-size:26px;"
                    ></i>

                    <div>
                        <b>Camera Preview</b>
                    </div>

                    <div style="font-size:11px;padding:0 20px;">
                        Click below to request camera access.
                    </div>

                </div>

            </div>

            <div
                id="faceStatus"
                style="
                    font-size:12px;
                    color:var(--text-dim);
                    margin-bottom:10px;
                "
            ></div>

            <div
                style="
                    display:flex;
                    gap:10px;
                    justify-content:center;
                    flex-wrap:wrap;
                "
            >

                <button class="btn btn-outline" id="openCameraBtn">
                    <i class="fa-solid fa-video"></i>
                    Open Camera
                </button>

                <button
                    class="btn btn-primary"
                    id="verifyFaceBtn"
                    ${FACE_ENROLLED ? 'disabled' : 'disabled'}
                >
                    <i class="fa-solid fa-face-smile"></i>
                    Verify My Face
                </button>

                ${
                    !FACE_ENROLLED
                        ? `
                            <button
                                class="btn btn-outline"
                                id="skipFaceBtn"
                            >
                                Skip (not enrolled)
                            </button>
                        `
                        : ''
                }

            </div>

        </div>
    `;
}


function wireFace() {

    const openBtn = document.getElementById('openCameraBtn');
    const verifyBtn = document.getElementById('verifyFaceBtn');
    const skipBtn = document.getElementById('skipFaceBtn');
    const statusEl = document.getElementById('faceStatus');
    const video = document.getElementById('faceVideo');

    if (!openBtn || !verifyBtn || !statusEl || !video) return;

    openBtn.addEventListener('click', async () => {

        try {

            if (faceStream) {
                stopCamera(faceStream);
                faceStream = null;
            }

            faceStream = await openCamera(video);

            video.style.display = 'block';

            document.getElementById('faceFallback').style.display = 'none';

            if (FACE_ENROLLED) {
                verifyBtn.disabled = false;
            }

            statusEl.textContent = 'Camera ready.';

        } catch (error) {

            console.error('Face camera error:', error);

            statusEl.textContent =
                'Camera access unavailable or denied.';
        }
    });


    verifyBtn.addEventListener('click', async () => {

        if (!faceStream || video.readyState < video.HAVE_CURRENT_DATA) {

            statusEl.textContent =
                'Please open the camera first.';

            return;
        }

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
                descriptor: descriptor,
                simulated: false
            };

            statusEl.innerHTML =
                '<i class="fa-solid fa-circle-check" ' +
                'style="color:var(--green);"></i> ' +
                'Face captured, verifying…';

            setTimeout(advanceStep, 400);

        } catch (error) {

            console.error('Face capture error:', error);

            stopCamera(faceStream);
            faceStream = null;

            /*
             * IMPORTANT:
             * If the user IS enrolled, Face is required.
             * Do not claim they can continue when there is no
             * skip button.
             */
            statusEl.textContent =
                FACE_ENROLLED
                    ? 'Face verification failed. Please open the camera and try again.'
                    : 'Face capture failed. You may skip because no face is enrolled.';

            verifyBtn.disabled = false;
        }
    });


    if (skipBtn) {

        skipBtn.addEventListener('click', () => {

            stopCamera(faceStream);
            faceStream = null;

            collected.FACE = {
                descriptor: null,
                skipped: true,
                simulated: true
            };

            advanceStep();
        });
    }
}


/* =========================================================
   FINGERPRINT
   ========================================================= */

function fingerprintStepHTML() {

    return `
        <div class="scan-box">

            <h3 style="margin:0 0 6px;">
                Biometric Sensor
            </h3>

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
                style="
                    margin-top:12px;
                    font-size:12.5px;
                    color:var(--text-dim);
                "
            ></div>

        </div>
    `;
}


function wireFingerprint() {

    const btn = document.getElementById('fingerprintBtn');
    const statusEl = document.getElementById('fpStatus');

    if (!btn || !statusEl) return;

    btn.addEventListener('click', async () => {

        btn.disabled = true;

        /*
         * INTENTIONAL SIMULATION FOR NOW
         *
         * Real WebAuthn can replace this later.
         */
        if (!window.PublicKeyCredential) {

            statusEl.textContent =
                'WebAuthn not supported on this device — simulating verification.';

            collected.FINGERPRINT = {
                verified: true,
                simulated: true
            };

            setTimeout(advanceStep, 700);

            return;
        }

        statusEl.textContent =
            'Biometric prompt simulated for testing…';

        collected.FINGERPRINT = {
            verified: true,
            simulated: true
        };

        setTimeout(advanceStep, 1200);
    });
}


/* =========================================================
   STEP CONTROL
   ========================================================= */

function wireStepEvents(method) {

    if (method === 'QR') {
        wireQr();
    } else if (method === 'GPS') {
        wireGps();
    } else if (method === 'FACE') {
        wireFace();
    } else if (method === 'FINGERPRINT') {
        wireFingerprint();
    }
}


function advanceStep() {

    currentStepIndex++;

    renderStep();
}


/* =========================================================
   FINAL SUBMISSION
   ========================================================= */

async function finalizeCheckIn() {

    setBanner(
        'Submitting attendance…',
        'Verifying methods with server'
    );

    const stepPanel = document.getElementById('stepPanel');

    if (stepPanel) {
        stepPanel.innerHTML = `
            <div class="scan-box">
                <i class="fa-solid fa-spinner fa-spin"></i>
                Submitting attendance…
            </div>
        `;
    }

    /*
     * CLIENT-SIDE SAFETY CHECK
     *
     * This isn't the final security check. PHP also checks this.
     */
    for (const method of REQUIRED_METHODS) {

        if (!Object.prototype.hasOwnProperty.call(collected, method)) {

            showResult({
                ok: false,
                message: `${METHOD_META[method]?.title || method} was not completed.`
            });

            return;
        }
    }

    try {

        const response = await fetch('checkin.php', {

            method: 'POST',

            credentials: 'same-origin',

            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },

            body: JSON.stringify({
                session_id: SESSION_ID,
                methods: REQUIRED_METHODS,
                collected: collected
            })
        });

        /*
         * Always read the response as text first.
         *
         * This is important because if PHP accidentally outputs
         * a warning/HTML before the JSON, response.json() would
         * throw and hide the real server error.
         */
        const responseText = await response.text();

        let data;

        try {
            data = JSON.parse(responseText);
        } catch (jsonError) {

            console.error('Invalid PHP JSON response:', responseText);

            showResult({
                ok: false,
                message:
                    `Server returned an invalid response (HTTP ${response.status}).`
            });

            return;
        }

        console.log('Check-in response:', data);

        if (!response.ok || !data.ok) {

            showResult({
                ok: false,
                message: data.message || 'Attendance could not be recorded.'
            });

            return;
        }

        /*
         * SUCCESS
         */
        showResult(data);

    } catch (error) {

        console.error('Check-in submission error:', error);

        showResult({
            ok: false,
            message:
                'Network error while submitting attendance. Please try again.'
        });
    }
}


/* =========================================================
   RESULT
   ========================================================= */

function showResult(data) {

    const stepPanel = document.getElementById('stepPanel');
    const methodGrid = document.getElementById('methodGrid');
    const resultPanel = document.getElementById('resultPanel');

    if (stepPanel) {
        stepPanel.style.display = 'none';
    }

    if (methodGrid) {
        methodGrid.style.display = 'none';
    }

    if (!resultPanel) {
        return;
    }

    resultPanel.style.display = 'block';

    if (data && data.ok) {

        setBanner(
            'Check-in Complete',
            'Your attendance has been successfully recorded.'
        );

        resultPanel.innerHTML = `
            <h3 style="color:var(--green);">
                <i class="fa-solid fa-circle-check"></i>
                Attendance Recorded
            </h3>

            <p style="color:var(--text-dim);font-size:13.5px;">

                Check-in time:
                <b>${escapeHtml(data.time || 'N/A')}</b>

                <br>

                Status:
                <b>${escapeHtml(data.status_label || data.status || 'Recorded')}</b>

                <br>

                GPS distance from nearest geofence:
                <b>${escapeHtml(data.distance ?? 'N/A')}</b>

                <br>

                Face match:
                <b>${escapeHtml(data.face_match ?? 'N/A')}</b>
            </p>

            <a
                class="btn btn-primary"
                href="portal.html"
            >
                View My Attendance History
            </a>
        `;

        return;
    }

    setBanner(
        'Check-in Failed',
        ''
    );

    resultPanel.innerHTML = `
        <h3 style="color:var(--red);">
            <i class="fa-solid fa-triangle-exclamation"></i>
            ${escapeHtml(
                data?.message || 'Something went wrong.'
            )}
        </h3>

        <button
            class="btn btn-outline"
            onclick="location.reload()"
        >
            Try Again
        </button>
    `;
}
