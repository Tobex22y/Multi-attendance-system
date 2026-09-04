<?php

require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/functions.php';

/*
|--------------------------------------------------------------------------
| APPLICATION TIMEZONE
|--------------------------------------------------------------------------
| Nigeria uses West Africa Time (UTC+1).
| We use PHP's timezone instead of relying on MySQL NOW(), because the
| database server may be running in UTC.
*/
date_default_timezone_set('Africa/Lagos');

$user = require_login();

header('Content-Type: application/json; charset=utf-8');

/*
|--------------------------------------------------------------------------
| Helper: return a JSON error and stop execution
|--------------------------------------------------------------------------
*/
function checkin_error(string $message, int $statusCode = 422, array $extra = []): void
{
    json_response(
        array_merge(
            [
                'ok' => false,
                'message' => $message
            ],
            $extra
        ),
        $statusCode
    );
}

/*
|--------------------------------------------------------------------------
| Read request
|--------------------------------------------------------------------------
*/
$rawBody = file_get_contents('php://input');
$body = json_decode($rawBody, true);

if (!is_array($body)) {
    checkin_error('Invalid request payload.', 422);
}

$sessionId = (int)($body['session_id'] ?? 0);
$collected = $body['collected'] ?? [];

if (!is_array($collected)) {
    checkin_error('Invalid verification data.', 422);
}

/*
|--------------------------------------------------------------------------
| REQUIRED METHODS
|--------------------------------------------------------------------------
| The server determines the required methods.
| Do NOT trust the methods array sent by JavaScript.
|
| Default:
|   QR + GPS + FACE
|
| Fingerprint is additionally required if the logged-in user has enrolled
| a fingerprint.
*/
$requiredMethods = ['QR', 'GPS', 'FACE'];

if (!empty($user['fingerprint_enrolled'])) {
    $requiredMethods[] = 'FINGERPRINT';
}

/*
|--------------------------------------------------------------------------
| Current application time
|--------------------------------------------------------------------------
*/
$now = new DateTime('now', new DateTimeZone('Africa/Lagos'));

/*
|--------------------------------------------------------------------------
| Session validation
|--------------------------------------------------------------------------
*/
$session = null;

if ($sessionId <= 0) {
    checkin_error('A valid attendance session is required.', 422);
}

$sessionStmt = $conn->prepare(
    'SELECT
        id,
        course_code,
        course_name,
        starts_at,
        ends_at,
        latitude,
        longitude,
        radius_m,
        is_active
     FROM attendance_sessions
     WHERE id = ?
     LIMIT 1'
);

if (!$sessionStmt) {
    checkin_error(
        'Database error while preparing the attendance session query: ' . $conn->error,
        500
    );
}

$sessionStmt->bind_param('i', $sessionId);

if (!$sessionStmt->execute()) {
    checkin_error(
        'Database error while checking the attendance session: ' . $sessionStmt->error,
        500
    );
}

$result = $sessionStmt->get_result();
$session = $result->fetch_assoc();

if (!$session) {
    checkin_error(
        'Attendance session #' . $sessionId . ' was not found.',
        404
    );
}

/*
|--------------------------------------------------------------------------
| Convert database session times to PHP DateTime
|--------------------------------------------------------------------------
|
| The DATETIME values are interpreted as Africa/Lagos time.
| This avoids depending on MySQL's timezone configuration.
*/
try {
    $sessionStart = new DateTime(
        $session['starts_at'],
        new DateTimeZone('Africa/Lagos')
    );

    $sessionEnd = new DateTime(
        $session['ends_at'],
        new DateTimeZone('Africa/Lagos')
    );
} catch (Exception $e) {
    checkin_error(
        'Invalid attendance session time configuration: ' . $e->getMessage(),
        500
    );
}

/*
|--------------------------------------------------------------------------
| SERVER-SIDE SESSION OPEN CHECK
|--------------------------------------------------------------------------
*/
if ((int)$session['is_active'] !== 1) {
    checkin_error(
        'This course attendance session is not active.'
    );
}

if ($now < $sessionStart) {
    checkin_error(
        'This course attendance session has not started yet.',
        422,
        [
            'server_time' => $now->format('Y-m-d H:i:s'),
            'session_start' => $sessionStart->format('Y-m-d H:i:s')
        ]
    );
}

if ($now > $sessionEnd) {
    checkin_error(
        'This course attendance session has already ended.',
        422,
        [
            'server_time' => $now->format('Y-m-d H:i:s'),
            'session_end' => $sessionEnd->format('Y-m-d H:i:s')
        ]
    );
}

/*
|--------------------------------------------------------------------------
| DUPLICATE ATTENDANCE CHECK
|--------------------------------------------------------------------------
*/
$duplicateStmt = $conn->prepare(
    'SELECT id
     FROM attendance_logs
     WHERE user_id = ?
       AND session_id = ?
     LIMIT 1'
);

if (!$duplicateStmt) {
    checkin_error(
        'Database error while checking previous attendance: ' . $conn->error,
        500
    );
}

$duplicateStmt->bind_param(
    'ii',
    $user['id'],
    $sessionId
);

if (!$duplicateStmt->execute()) {
    checkin_error(
        'Database error while checking previous attendance: ' . $duplicateStmt->error,
        500
    );
}

if ($duplicateStmt->get_result()->num_rows > 0) {
    checkin_error(
        'You have already marked attendance for this course.',
        409
    );
}

/*
|--------------------------------------------------------------------------
| VERIFICATION VARIABLES
|--------------------------------------------------------------------------
*/
$methodsUsed = [];

$qrVerified = 0;

$gpsVerified = false;
$gpsLat = null;
$gpsLng = null;
$distance = null;

$faceVerified = false;
$faceMatch = null;

$fingerprintVerified = 0;

$status = 'on_time';

/*
|--------------------------------------------------------------------------
| 1. QR VERIFICATION
|--------------------------------------------------------------------------
|
| The browser may claim QR verification, but the server checks the actual
| QR secret against the logged-in user's stored secret.
*/
if (empty($collected['QR']) || empty($collected['QR']['verified'])) {
    checkin_error(
        'QR verification was not completed.'
    );
}

$scannedCode = (string)($collected['QR']['code'] ?? '');

if ($scannedCode === '') {
    checkin_error(
        'No QR code was submitted.'
    );
}

if (!hash_equals((string)$user['qr_secret'], $scannedCode)) {
    checkin_error(
        'QR code does not match your digital badge. Please rescan.'
    );
}

$qrVerified = 1;
$methodsUsed[] = 'QR';

/*
|--------------------------------------------------------------------------
| 2. GPS VERIFICATION
|--------------------------------------------------------------------------
|
| GPS coordinates come from the browser, but the SERVER calculates the
| distance and decides whether the user is inside the session geofence.
*/
if (
    !isset($collected['GPS']) ||
    !isset($collected['GPS']['lat']) ||
    !isset($collected['GPS']['lng'])
) {
    checkin_error(
        'GPS verification was not completed.'
    );
}

$gpsLat = (float)$collected['GPS']['lat'];
$gpsLng = (float)$collected['GPS']['lng'];

/*
| Basic coordinate validation.
*/
if (
    !is_finite($gpsLat) ||
    !is_finite($gpsLng) ||
    $gpsLat < -90 ||
    $gpsLat > 90 ||
    $gpsLng < -180 ||
    $gpsLng > 180
) {
    checkin_error(
        'Invalid GPS coordinates were submitted.'
    );
}

/*
| IMPORTANT:
| Simulated GPS is NOT accepted by the server.
*/
if (!empty($collected['GPS']['simulated'])) {
    checkin_error(
        'Simulated GPS coordinates cannot be used for attendance.'
    );
}

/*
| Calculate distance from the attendance session location.
*/
$distance = (int)round(
    gps_distance_meters(
        $gpsLat,
        $gpsLng,
        (float)$session['latitude'],
        (float)$session['longitude']
    )
);

$allowedRadius = (int)$session['radius_m'];

if ($distance > $allowedRadius) {
    checkin_error(
        'You are outside the attendance geofence.',
        422,
        [
            'distance' => $distance . 'm',
            'allowed_radius' => $allowedRadius . 'm'
        ]
    );
}

$gpsVerified = true;
$methodsUsed[] = 'GPS';

/*
|--------------------------------------------------------------------------
| 3. FACE VERIFICATION
|--------------------------------------------------------------------------
|
| The client sends a 128-value face descriptor.
| The server compares it with the enrolled descriptor.
|
| IMPORTANT:
| A missing face descriptor is NOT accepted.
| A user without an enrolled face cannot pass this required verification.
*/
if (
    !isset($collected['FACE']) ||
    !array_key_exists('descriptor', $collected['FACE'])
) {
    checkin_error(
        'Face verification was not completed.'
    );
}

$descriptor = $collected['FACE']['descriptor'];

if (!is_array($descriptor)) {
    checkin_error(
        'Invalid face descriptor submitted.'
    );
}

if (count($descriptor) !== 128) {
    checkin_error(
        'Invalid face descriptor. A 128-value face descriptor is required.'
    );
}

/*
| The user must have an enrolled face.
*/
if (empty($user['face_enrolled']) || empty($user['face_template'])) {
    checkin_error(
        'Face verification is required, but no enrolled face is available for your account.'
    );
}

$storedTemplate = json_decode(
    $user['face_template'],
    true
);

if (!is_array($storedTemplate) || count($storedTemplate) !== 128) {
    checkin_error(
        'Your enrolled face template is invalid. Please enroll your face again or contact an administrator.',
        500
    );
}

/*
| Make sure every descriptor value is numeric and finite.
*/
foreach ($descriptor as $value) {
    if (!is_numeric($value) || !is_finite((float)$value)) {
        checkin_error(
            'Invalid face descriptor values were submitted.'
        );
    }
}

/*
| Calculate server-side face distance.
*/
$faceDistance = face_euclidean_distance(
    $storedTemplate,
    $descriptor
);

if ($faceDistance === null || !is_finite((float)$faceDistance)) {
    checkin_error(
        'Face comparison could not be completed.',
        500
    );
}

$faceMatch = face_distance_to_percent($faceDistance);

/*
| Server-controlled face distance threshold.
*/
$threshold = (float)get_setting(
    'face_distance_threshold',
    0.6
);

if ($faceDistance > $threshold) {
    checkin_error(
        'Face verification failed. The captured face does not match the enrolled face.',
        422,
        [
            'face_match' => $faceMatch . '%'
        ]
    );
}

$faceVerified = true;
$methodsUsed[] = 'FACE';

/*
|--------------------------------------------------------------------------
| 4. FINGERPRINT / WEBAUTHN
|--------------------------------------------------------------------------
|
| If fingerprint enrollment is enabled for the account, it is required.
|
| IMPORTANT:
| The old code accepted:
|
|     { verified: true }
|
| from JavaScript without any real server-side proof.
|
| That is NOT secure and is therefore rejected here.
|
| A proper implementation must send a WebAuthn assertion generated by
| navigator.credentials.get() and verify it server-side.
*/
if (!empty($user['fingerprint_enrolled'])) {

    /*
    | For now, do NOT accept the old fake "verified: true" flag.
    */
    if (
        empty($collected['FINGERPRINT']) ||
        empty($collected['FINGERPRINT']['assertion'])
    ) {
        checkin_error(
            'Fingerprint verification is required, but no valid WebAuthn assertion was submitted.'
        );
    }

    /*
    | The actual WebAuthn verification should be performed here.
    |
    | Your current project does not provide a WebAuthn server verification
    | function in the code supplied so far.
    |
    | We deliberately refuse to mark it as verified rather than pretending
    | that a client-side flag is secure.
    */
    checkin_error(
        'Fingerprint verification requires server-side WebAuthn validation. The biometric assertion was received, but a WebAuthn verification handler has not been configured yet.',
        501
    );

} else {

    /*
    | Fingerprint is not required for this user.
    */
    $fingerprintVerified = 0;
}

/*
|--------------------------------------------------------------------------
| FINAL REQUIRED-METHOD CHECK
|--------------------------------------------------------------------------
|
| This is the server's final gate.
*/
$verificationState = [
    'QR' => $qrVerified === 1,
    'GPS' => $gpsVerified === true,
    'FACE' => $faceVerified === true,
];

if (in_array('FINGERPRINT', $requiredMethods, true)) {
    $verificationState['FINGERPRINT'] = $fingerprintVerified === 1;
}

foreach ($requiredMethods as $requiredMethod) {
    if (empty($verificationState[$requiredMethod])) {
        checkin_error(
            $requiredMethod . ' verification was not successfully completed.'
        );
    }
}

/*
|--------------------------------------------------------------------------
| TIME-BASED STATUS
|--------------------------------------------------------------------------
*/
$graceMinutes = (int)get_setting(
    'grace_period_minutes',
    15
);

/*
| For a course session, use the session start time.
| The existing helper is retained where possible.
*/
try {
    /*
    | Use PHP/Lagos time consistently.
    */
    $sessionStartForStatus = new DateTime(
        $session['starts_at'],
        new DateTimeZone('Africa/Lagos')
    );

    $lateBoundary = clone $sessionStartForStatus;
    $lateBoundary->modify('+' . $graceMinutes . ' minutes');

    if ($now > $lateBoundary) {
        $status = 'late';
    }

} catch (Exception $e) {
    checkin_error(
        'Unable to calculate attendance time status: ' . $e->getMessage(),
        500
    );
}

/*
|--------------------------------------------------------------------------
| INSERT ATTENDANCE
|--------------------------------------------------------------------------
*/
$methodsStr = implode(',', $methodsUsed);

$checkInStr = $now->format('Y-m-d H:i:s');

$storedSessionId = $sessionId;

/*
| No geofence_id is used for course-session attendance because the course
| session itself contains the authoritative latitude/longitude/radius.
*/
$geofenceId = null;

$stmt = $conn->prepare(
    'INSERT INTO attendance_logs
    (
        user_id,
        session_id,
        geofence_id,
        check_in_time,
        status,
        methods_used,
        gps_lat,
        gps_lng,
        gps_distance_m,
        face_match_pct,
        qr_verified,
        fingerprint_verified
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

if (!$stmt) {
    checkin_error(
        'Database error while preparing attendance record: ' . $conn->error,
        500
    );
}

/*
| Types:
|
| i = user_id
| i = session_id
| i = geofence_id
| s = check_in_time
| s = status
| s = methods_used
| d = gps_lat
| d = gps_lng
| d = distance
| d = face_match
| i = qr_verified
| i = fingerprint_verified
*/
$stmt->bind_param(
    'iiisssddddii',
    $user['id'],
    $storedSessionId,
    $geofenceId,
    $checkInStr,
    $status,
    $methodsStr,
    $gpsLat,
    $gpsLng,
    $distance,
    $faceMatch,
    $qrVerified,
    $fingerprintVerified
);

if (!$stmt->execute()) {
    checkin_error(
        'Database error while recording attendance: ' . $stmt->error,
        500
    );
}

/*
|--------------------------------------------------------------------------
| SUCCESS
|--------------------------------------------------------------------------
*/
json_response([
    'ok' => true,
    'status' => $status,
    'status_label' => badge_label($status),
    'message' => 'Attendance Recorded',
    'time' => $now->format('n/j/Y, g:i:s A'),
    'timezone' => 'Africa/Lagos',
    'distance' => $distance . 'm',
    'face_match' => $faceMatch . '%',
    'methods_used' => $methodsUsed
]);
