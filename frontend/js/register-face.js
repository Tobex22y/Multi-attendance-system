/**
 * Face enrollment on the sign-up form: open the camera, capture one descriptor
 * with face-api.js, and stash it in a hidden field so it's submitted along
 * with the rest of the registration form.
 */
let enrollStream = null;

const enrollVideo = document.getElementById('enrollVideo');
const enrollFallback = document.getElementById('enrollFallback');
const enrollStatus = document.getElementById('enrollStatus');
const openEnrollCameraBtn = document.getElementById('openEnrollCameraBtn');
const captureFaceBtn = document.getElementById('captureFaceBtn');
const faceDescriptorInput = document.getElementById('faceDescriptorInput');

openEnrollCameraBtn.addEventListener('click', async () => {
    try {
        enrollStatus.textContent = 'Requesting camera access…';
        enrollStream = await openCamera(enrollVideo);
        enrollVideo.style.display = 'block';
        enrollFallback.style.display = 'none';
        captureFaceBtn.disabled = false;
        enrollStatus.textContent = 'Camera ready. Center your face and click "Capture Face".';
    } catch (e) {
        enrollStatus.textContent = e.message || 'Camera access denied or unavailable. You can still register without face enrollment.';
    }
});

captureFaceBtn.addEventListener('click', async () => {
    captureFaceBtn.disabled = true;
    try {
        const descriptor = await captureFaceDescriptor(enrollVideo, (msg) => { enrollStatus.textContent = msg; });
        if (!descriptor) {
            enrollStatus.textContent = 'No face detected — make sure your face is well-lit and centered, then try again.';
            captureFaceBtn.disabled = false;
            return;
        }
        faceDescriptorInput.value = JSON.stringify(descriptor);
        enrollStatus.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--green);"></i> Face captured! You can re-capture if needed before submitting.';
        captureFaceBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Re-capture';
        captureFaceBtn.disabled = false;
    } catch (e) {
        enrollStatus.textContent = e.message || 'Face capture failed. You can still register without it.';
        captureFaceBtn.disabled = false;
    }
});

window.addEventListener('beforeunload', () => stopCamera(enrollStream));
