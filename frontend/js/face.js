/**
 * Thin wrapper around face-api.js for two use cases:
 *   1. Enrollment (register page): capture a descriptor once and store it.
 *   2. Verification (check-in page): capture a live descriptor to compare server-side.
 *
 * Models are pretrained, publicly hosted weight files (no training happens here) —
 * loaded once per page and cached in `faceModelsLoaded`.
 */
const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
let faceModelsLoaded = false;
let faceModelsLoading = null;

async function ensureFaceModelsLoaded(onStatus) {
    if (faceModelsLoaded) return;
    if (faceModelsLoading) return faceModelsLoading;

    faceModelsLoading = (async () => {
        if (onStatus) onStatus('Loading face recognition models…');
        await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL);
        faceModelsLoaded = true;
    })();

    try {
        await faceModelsLoading;
    } catch (error) {
        faceModelsLoading = null;
        throw new Error('Face recognition models could not be loaded. Check your internet connection and reload the page.');
    }
}

/**
 * Detect a single face in a live <video> element and return its 128-point
 * descriptor as a plain JS array, or null if no face was found.
 */

async function captureFaceDescriptor(videoEl, onStatus) {
    await ensureFaceModelsLoaded(onStatus);

    if (!videoEl) {
        throw new Error('Face camera video element was not found.');
    }

    if (videoEl.readyState < 2) {
        if (onStatus) {
            onStatus('Waiting for camera video…');
        }

        await new Promise((resolve) => {
            const checkVideo = () => {
                if (videoEl.readyState >= 2) {
                    resolve();
                } else {
                    setTimeout(checkVideo, 200);
                }
            };

            checkVideo();
        });
    }

    if (onStatus) {
        onStatus('Looking for a face…');
    }

    /*
     * Give the camera a moment to stabilize.
     */
    await new Promise(resolve => setTimeout(resolve, 500));

    /*
     * Use more suitable detector settings for webcam video.
     *
     * inputSize:
     * Larger input = better chance of detecting a smaller face,
     * at the cost of a little more processing.
     *
     * scoreThreshold:
     * Lower value makes detection less strict.
     */
    const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,
        scoreThreshold: 0.35
    });

    const detection = await faceapi
        .detectSingleFace(videoEl, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

    if (!detection) {
        if (onStatus) {
            onStatus(
                'Face not detected. Move closer, face the camera directly, and improve the lighting.'
            );
        }

        return null;
    }

    if (
        !detection.descriptor ||
        detection.descriptor.length !== 128
    ) {
        if (onStatus) {
            onStatus(
                'Face detected, but the face descriptor could not be generated.'
            );
        }

        return null;
    }

    if (onStatus) {
        onStatus('Face detected successfully.');
    }

    return Array.from(
        detection.descriptor,
        Number
    );
}

/** Open the device camera into a <video> element. Returns the MediaStream. */
async function openCamera(videoEl) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    videoEl.srcObject = stream;
    await videoEl.play();
    return stream;
}

function stopCamera(stream) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
}
