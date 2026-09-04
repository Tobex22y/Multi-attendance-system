<?php
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/functions.php';

$user = require_login(); // sends a 401 JSON response and stops if not logged in

$body = json_decode(file_get_contents('php://input'), true);
if (!$body) {
    json_response(['ok' => false, 'message' => 'Invalid request payload.'], 422);
}

$collected = $body['collected'] ?? [];
$sessionId = (int)($body['session_id'] ?? 0);
$methodsUsed = [];
$gpsLat = $gpsLng = $distance = null;
$geofenceId = null;
$faceMatch = null;
$qrVerified = 0;
$fingerprintVerified = 0;
$status = 'on_time';

$session = null;
if ($sessionId > 0) {
    $sessionStmt = $conn->prepare(
        'SELECT * FROM attendance_sessions
         WHERE id = ? AND is_active = 1 AND starts_at <= NOW() AND ends_at >= NOW()
         LIMIT 1'
    );
    $sessionStmt->bind_param('i', $sessionId);
    $sessionStmt->execute();
    $session = $sessionStmt->get_result()->fetch_assoc();
    if (!$session) {
        json_response(['ok' => false, 'message' => 'This course attendance session is not currently open.'], 422);
    }
    $duplicateStmt = $conn->prepare('SELECT id FROM attendance_logs WHERE user_id = ? AND session_id = ? LIMIT 1');
    $duplicateStmt->bind_param('ii', $user['id'], $sessionId);
    $duplicateStmt->execute();
    if ($duplicateStmt->get_result()->num_rows > 0) {
        json_response(['ok' => false, 'message' => 'You have already marked attendance for this course.'], 409);
    }
}

// --- QR ---
if (!empty($collected['QR']['verified'])) {
    $scannedCode = $collected['QR']['code'] ?? '';
    if ($scannedCode !== $user['qr_secret']) {
        json_response(['ok' => false, 'message' => 'QR code does not match your digital badge. Please rescan.']);
    }
    $qrVerified = 1;
    $methodsUsed[] = 'QR';
}

// --- GPS ---
if (isset($collected['GPS']['lat'], $collected['GPS']['lng'])) {
    $gpsLat = (float)$collected['GPS']['lat'];
    $gpsLng = (float)$collected['GPS']['lng'];
    if ($session) {
        $distance = (int)round(gps_distance_meters(
            $gpsLat,
            $gpsLng,
            (float)$session['latitude'],
            (float)$session['longitude']
        ));
        if ($distance > (int)$session['radius_m']) {
            $status = 'geofence_violation';
        }
    } else {
        $nearest = find_nearest_geofence($conn, $gpsLat, $gpsLng);
        if ($nearest['geofence']) {
            $geofenceId = $nearest['geofence']['id'];
            $distance = (int)round($nearest['distance']);
            if (!$nearest['within']) {
                $status = 'geofence_violation';
            }
        }
    }
    $methodsUsed[] = 'GPS';
}

// --- FACE ---
if (array_key_exists('FACE', $collected)) {
    $descriptor = $collected['FACE']['descriptor'] ?? null; // array of 128 floats from face-api.js
    $methodsUsed[] = 'FACE';

    if (is_array($descriptor) && count($descriptor) === 128 && $user['face_enrolled'] && $user['face_template']) {
        $storedTemplate = json_decode($user['face_template'], true);
        $faceDistance = is_array($storedTemplate) && count($storedTemplate) === 128
            ? face_euclidean_distance($storedTemplate, $descriptor)
            : null;
        if ($faceDistance !== null) {
            $faceMatch = face_distance_to_percent($faceDistance);
            $threshold = (float)get_setting('face_distance_threshold', 0.6);
            if ($faceDistance > $threshold && $status === 'on_time') {
                $status = 'face_mismatch';
            }
        }
    }
    // If the user has no enrolled face template yet, or no descriptor was captured
    // (camera denied, etc.), the check-in proceeds without a face score rather than
    // blocking attendance — mirrors the "N/A" face score seen for non-enrolled users.
}

// --- FINGERPRINT ---
if (!empty($collected['FINGERPRINT']['verified'])) {
    $fingerprintVerified = 1;
    $methodsUsed[] = 'FINGERPRINT';
}

// --- Time-based status (only overrides on_time, doesn't downgrade a violation) ---
$now = new DateTime();
$graceMinutes = (int)get_setting('grace_period_minutes', 15);
$timeStatus = $session
    ? compute_session_time_status($session['ends_at'], 0, $now)
    : compute_time_status($user['shift_start'], $graceMinutes, $now);
if ($status === 'on_time' && $timeStatus === 'late') {
    $status = 'late';
}

$methodsStr = implode(',', $methodsUsed);
$storedSessionId = $sessionId ?: null;

$stmt = $conn->prepare(
    'INSERT INTO attendance_logs
    (user_id, session_id, geofence_id, check_in_time, status, methods_used, gps_lat, gps_lng, gps_distance_m, face_match_pct, qr_verified, fingerprint_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
$checkInStr = $now->format('Y-m-d H:i:s');
$stmt->bind_param(
        'iiisssddddii',
        $user['id'], $storedSessionId, $geofenceId, $checkInStr, $status, $methodsStr,
    $gpsLat, $gpsLng, $distance, $faceMatch, $qrVerified, $fingerprintVerified
);
$stmt->execute();

json_response([
    'ok' => true,
    'status' => $status,
    'status_label' => badge_label($status),
    'time' => $now->format('n/j/Y, g:i:s A'),
    'distance' => $distance !== null ? $distance . 'm' : null,
    'face_match' => $faceMatch !== null ? $faceMatch . '%' : null,
]);
