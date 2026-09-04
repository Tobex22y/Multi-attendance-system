<?php

/*
 * DEVELOPMENT ERROR VISIBILITY
 *
 * Turn these OFF in production.
 */
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function checkin_error_handler($severity, $message, $file, $line)
{
    throw new ErrorException(
        $message,
        0,
        $severity,
        $file,
        $line
    );
}

set_error_handler('checkin_error_handler');

set_exception_handler(function ($e) {
    http_response_code(500);

    echo json_encode([
        'ok' => false,
        'message' => 'PHP error while processing check-in.',
        'error' => $e->getMessage(),
        'file' => basename($e->getFile()),
        'line' => $e->getLine()
    ]);

    exit;
});

require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/functions.php';

try {

    $user = require_login();

    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        json_response([
            'ok' => false,
            'message' => 'Empty request payload.'
        ], 422);
    }

    $body = json_decode($rawBody, true);

    if (!is_array($body)) {
        json_response([
            'ok' => false,
            'message' => 'Invalid JSON request payload.',
            'error' => json_last_error_msg()
        ], 422);
    }

    $collected = $body['collected'] ?? [];
    $sessionId = (int)($body['session_id'] ?? 0);

    if (!is_array($collected)) {
        json_response([
            'ok' => false,
            'message' => 'Invalid verification data.'
        ], 422);
    }

    /*
     * =========================================================
     * SERVER DEFINES REQUIRED METHODS
     * =========================================================
     *
     * DO NOT trust $body['methods'].
     */
    $requiredMethods = [
        'QR',
        'GPS',
        'FACE'
    ];

    if (!empty($user['fingerprint_enrolled'])) {
        $requiredMethods[] = 'FINGERPRINT';
    }

    /*
     * =========================================================
     * SESSION
     * =========================================================
     */

    $session = null;

    if ($sessionId > 0) {

        $sessionStmt = $conn->prepare(
            'SELECT *
             FROM attendance_sessions
             WHERE id = ?
               AND is_active = 1
               AND starts_at <= NOW()
               AND ends_at >= NOW()
             LIMIT 1'
        );

        $sessionStmt->bind_param('i', $sessionId);
        $sessionStmt->execute();

        $session = $sessionStmt
            ->get_result()
            ->fetch_assoc();

        if (!$session) {
            json_response([
                'ok' => false,
                'message' =>
                    'This course attendance session is not currently open.'
            ], 422);
        }

        /*
         * Prevent duplicate attendance.
         */
        $duplicateStmt = $conn->prepare(
            'SELECT id
             FROM attendance_logs
             WHERE user_id = ?
               AND session_id = ?
             LIMIT 1'
        );

        $duplicateStmt->bind_param(
            'ii',
            $user['id'],
            $sessionId
        );

        $duplicateStmt->execute();

        if ($duplicateStmt->get_result()->num_rows > 0) {
            json_response([
                'ok' => false,
                'message' =>
                    'You have already marked attendance for this course.'
            ], 409);
        }
    }

    /*
     * =========================================================
     * INITIAL VALUES
     * =========================================================
     */

    $methodsUsed = [];

    $gpsLat = null;
    $gpsLng = null;
    $distance = null;
    $geofenceId = null;

    $faceMatch = null;

    $qrVerified = 0;
    $fingerprintVerified = 0;

    $status = 'on_time';

    /*
     * =========================================================
     * 1. QR
     * =========================================================
     */

    if (
        empty($collected['QR']) ||
        empty($collected['QR']['verified'])
    ) {
        json_response([
            'ok' => false,
            'message' => 'QR verification was not completed.'
        ], 422);
    }

    $scannedCode = (string)(
        $collected['QR']['code'] ?? ''
    );

    if ($scannedCode === '') {
        json_response([
            'ok' => false,
            'message' => 'QR verification did not contain a code.'
        ], 422);
    }

    /*
     * The simulation still works because it supplies the
     * user's QR secret.
     */
    if (!hash_equals(
        (string)$user['qr_secret'],
        $scannedCode
    )) {
        json_response([
            'ok' => false,
            'message' =>
                'QR code does not match your digital badge. Please rescan.'
        ], 422);
    }

    $qrVerified = 1;
    $methodsUsed[] = 'QR';

    /*
     * =========================================================
     * 2. GPS
     * =========================================================
     */

    if (
        !isset(
            $collected['GPS']['lat'],
            $collected['GPS']['lng']
        )
    ) {
        json_response([
            'ok' => false,
            'message' => 'GPS verification was not completed.'
        ], 422);
    }

    $gpsLat = filter_var(
        $collected['GPS']['lat'],
        FILTER_VALIDATE_FLOAT
    );

    $gpsLng = filter_var(
        $collected['GPS']['lng'],
        FILTER_VALIDATE_FLOAT
    );

    if ($gpsLat === false || $gpsLng === false) {
        json_response([
            'ok' => false,
            'message' => 'Invalid GPS coordinates received.'
        ], 422);
    }

    $gpsLat = (float)$gpsLat;
    $gpsLng = (float)$gpsLng;

    /*
     * Server performs the actual distance calculation.
     */
    if ($session) {

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

            json_response([
                'ok' => false,
                'message' =>
                    'GPS verification failed. You are outside the approved attendance area.',
                'distance' => $distance . 'm',
                'allowed_radius' => $allowedRadius . 'm'
            ], 422);
        }

    } else {

        $nearest = find_nearest_geofence(
            $conn,
            $gpsLat,
            $gpsLng
        );

        if (
            empty($nearest) ||
            empty($nearest['geofence'])
        ) {
            json_response([
                'ok' => false,
                'message' =>
                    'No approved attendance geofence was found.'
            ], 422);
        }

        $geofenceId = $nearest['geofence']['id'];
        $distance = (int)round($nearest['distance']);

        if (empty($nearest['within'])) {
            json_response([
                'ok' => false,
                'message' =>
                    'GPS verification failed. You are outside the approved geofence.',
                'distance' => $distance . 'm'
            ], 422);
        }
    }

    $methodsUsed[] = 'GPS';

    /*
     * =========================================================
     * 3. FACE
     * =========================================================
     */

    if (!array_key_exists('FACE', $collected)) {
        json_response([
            'ok' => false,
            'message' => 'Face verification was not completed.'
        ], 422);
    }

    $descriptor =
        $collected['FACE']['descriptor'] ?? null;

    /*
     * User without enrolled face:
     * preserve existing behavior.
     */
    if (
        empty($user['face_enrolled']) ||
        empty($user['face_template'])
    ) {

        $methodsUsed[] = 'FACE';

    } else {

        /*
         * Enrolled user MUST provide a descriptor.
         */
        if (!is_array($descriptor)) {
            json_response([
                'ok' => false,
                'message' =>
                    'Face verification failed. No face descriptor was received.'
            ], 422);
        }

        if (count($descriptor) !== 128) {
            json_response([
                'ok' => false,
                'message' =>
                    'Face verification failed. Invalid face descriptor.'
            ], 422);
        }

        /*
         * Make sure all descriptor values are numeric.
         */
        foreach ($descriptor as $value) {
            if (!is_numeric($value)) {
                json_response([
                    'ok' => false,
                    'message' =>
                        'Face verification failed. Invalid descriptor data.'
                ], 422);
            }
        }

        $storedTemplate = json_decode(
            $user['face_template'],
            true
        );

        if (
            !is_array($storedTemplate) ||
            count($storedTemplate) !== 128
        ) {
            json_response([
                'ok' => false,
                'message' =>
                    'Your stored face template is invalid. Please contact an administrator.'
            ], 500);
        }

        $faceDistance = face_euclidean_distance(
            $storedTemplate,
            $descriptor
        );

        if ($faceDistance === null) {
            json_response([
                'ok' => false,
                'message' =>
                    'Face comparison could not be completed.'
            ], 422);
        }

        $faceMatch =
            face_distance_to_percent($faceDistance);

        $threshold = (float)get_setting(
            'face_distance_threshold',
            0.6
        );

        /*
         * Server makes the actual decision.
         */
        if ($faceDistance > $threshold) {

            json_response([
                'ok' => false,
                'message' =>
                    'Face verification failed. The face does not match the enrolled face.',
                'face_match' => $faceMatch . '%'
            ], 422);
        }

        $methodsUsed[] = 'FACE';
    }

    /*
     * =========================================================
     * 4. FINGERPRINT
     * =========================================================
     */

    if (in_array('FINGERPRINT', $requiredMethods, true)) {

        if (
            empty($collected['FINGERPRINT']) ||
            empty($collected['FINGERPRINT']['verified'])
        ) {
            json_response([
                'ok' => false,
                'message' =>
                    'Fingerprint verification was not completed.'
            ], 422);
        }

        /*
         * Simulation is intentionally retained.
         *
         * IMPORTANT:
         * This is NOT cryptographic WebAuthn verification.
         * Real WebAuthn requires a server challenge and
         * credential assertion verification.
         */
        $fingerprintVerified = 1;
        $methodsUsed[] = 'FINGERPRINT';
    }

    /*
     * =========================================================
     * FINAL SERVER-SIDE METHOD CHECK
     * =========================================================
     */

    $methodsUsed = array_values(
        array_unique($methodsUsed)
    );

    foreach ($requiredMethods as $required) {

        if (!in_array(
            $required,
            $methodsUsed,
            true
        )) {
            json_response([
                'ok' => false,
                'message' =>
                    "Required verification missing: {$required}."
            ], 422);
        }
    }

    /*
     * =========================================================
     * TIME STATUS
     * =========================================================
     */

    $now = new DateTime();

    $graceMinutes = (int)get_setting(
        'grace_period_minutes',
        15
    );

    $timeStatus = $session
        ? compute_session_time_status(
            $session['ends_at'],
            0,
            $now
        )
        : compute_time_status(
            $user['shift_start'],
            $graceMinutes,
            $now
        );

    if (
        $status === 'on_time' &&
        $timeStatus === 'late'
    ) {
        $status = 'late';
    }

    /*
     * =========================================================
     * INSERT ATTENDANCE
     * =========================================================
     */

    $methodsStr = implode(
        ',',
        $methodsUsed
    );

    $storedSessionId =
        $sessionId ?: null;

    $checkInStr =
        $now->format('Y-m-d H:i:s');

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

    $stmt->execute();

    /*
     * =========================================================
     * SUCCESS
     * =========================================================
     */

    json_response([
        'ok' => true,

        /*
         * This is the final success message the frontend
         * should display.
         */
        'message' => 'Attendance Recorded',

        'status' => $status,

        'status_label' =>
            badge_label($status),

        'time' =>
            $now->format('n/j/Y, g:i:s A'),

        'distance' =>
            $distance !== null
                ? $distance . 'm'
                : null,

        'face_match' =>
            $faceMatch !== null
                ? $faceMatch . '%'
                : null,

        'methods_used' =>
            $methodsUsed

    ]);

} catch (Throwable $e) {

    /*
     * This should normally be caught by the global
     * exception handler, but keeping this here gives
     * maximum visibility during development.
     */

    http_response_code(500);

    echo json_encode([
        'ok' => false,
        'message' =>
            'PHP error while processing check-in.',
        'error' =>
            $e->getMessage(),
        'file' =>
            basename($e->getFile()),
        'line' =>
            $e->getLine()
    ]);

    exit;
}
