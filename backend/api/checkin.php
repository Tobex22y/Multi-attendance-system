php
<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/functions.php';


/*
|--------------------------------------------------------------------------
| JSON / CORS / RESPONSE SETUP
|--------------------------------------------------------------------------
*/

header('Content-Type: application/json; charset=utf-8');


// Prevent PHP warnings/notices from corrupting JSON output.
// Errors should be logged instead.
ini_set('display_errors', '0');


function checkin_response(array $data, int $statusCode = 200): never
{
    http_response_code($statusCode);

    echo json_encode(
        $data,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );

    exit;
}


/*
|--------------------------------------------------------------------------
| AUTHENTICATION
|--------------------------------------------------------------------------
*/

$user = require_login();


/*
|--------------------------------------------------------------------------
| REQUEST METHOD
|--------------------------------------------------------------------------
*/

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {

    checkin_response([
        'ok' => false,
        'message' => 'Only POST requests are allowed.'
    ], 405);
}


/*
|--------------------------------------------------------------------------
| READ JSON BODY
|--------------------------------------------------------------------------
*/

$rawBody = file_get_contents('php://input');

if ($rawBody === false || trim($rawBody) === '') {

    checkin_response([
        'ok' => false,
        'message' => 'Empty request payload.'
    ], 422);
}


$body = json_decode($rawBody, true);


if (!is_array($body)) {

    checkin_response([
        'ok' => false,
        'message' => 'Invalid request payload.'
    ], 422);
}


$collected = $body['collected'] ?? [];
$sessionId = (int)($body['session_id'] ?? 0);


if (!is_array($collected)) {

    checkin_response([
        'ok' => false,
        'message' => 'Invalid verification data.'
    ], 422);
}


/*
|--------------------------------------------------------------------------
| REQUIRED METHODS
|--------------------------------------------------------------------------
|
| IMPORTANT:
| Do not trust the "methods" array sent by JavaScript.
|
| The server determines the required sequence.
|
*/

$requiredMethods = [
    'QR',
    'GPS',
    'FACE'
];


/*
 * Fingerprint is required only when the logged-in user has enrolled it.
 */
if (!empty($user['fingerprint_enrolled'])) {
    $requiredMethods[] = 'FINGERPRINT';
}


/*
|--------------------------------------------------------------------------
| SESSION
|--------------------------------------------------------------------------
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


    if (!$sessionStmt) {

        error_log(
            'Check-in session prepare failed: ' . $conn->error
        );

        checkin_response([
            'ok' => false,
            'message' => 'Unable to verify the attendance session.'
        ], 500);
    }


    $sessionStmt->bind_param(
        'i',
        $sessionId
    );


    if (!$sessionStmt->execute()) {

        error_log(
            'Check-in session execute failed: ' . $sessionStmt->error
        );

        checkin_response([
            'ok' => false,
            'message' => 'Unable to verify the attendance session.'
        ], 500);
    }


    $result = $sessionStmt->get_result();

    $session = $result->fetch_assoc();

    $sessionStmt->close();


    if (!$session) {

        checkin_response([
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


    if (!$duplicateStmt) {

        error_log(
            'Duplicate-check prepare failed: ' . $conn->error
        );

        checkin_response([
            'ok' => false,
            'message' => 'Unable to verify attendance status.'
        ], 500);
    }


    $duplicateStmt->bind_param(
        'ii',
        $user['id'],
        $sessionId
    );


    if (!$duplicateStmt->execute()) {

        error_log(
            'Duplicate-check execute failed: ' .
            $duplicateStmt->error
        );

        $duplicateStmt->close();

        checkin_response([
            'ok' => false,
            'message' => 'Unable to verify attendance status.'
        ], 500);
    }


    $duplicateResult = $duplicateStmt->get_result();


    if ($duplicateResult->num_rows > 0) {

        $duplicateStmt->close();

        checkin_response([
            'ok' => false,
            'message' =>
                'You have already marked attendance for this course.'
        ], 409);
    }


    $duplicateStmt->close();
}


/*
|--------------------------------------------------------------------------
| VERIFY THAT ALL REQUIRED METHODS WERE SUBMITTED
|--------------------------------------------------------------------------
|
| This is one of the major fixes.
|
*/

$missingMethods = [];


foreach ($requiredMethods as $method) {

    if (
        !array_key_exists($method, $collected)
        || !is_array($collected[$method])
    ) {
        $missingMethods[] = $method;
    }
}


if (!empty($missingMethods)) {

    checkin_response([
        'ok' => false,
        'message' =>
            'Attendance verification is incomplete. Missing: ' .
            implode(', ', $missingMethods)
    ], 422);
}


/*
|--------------------------------------------------------------------------
| VARIABLES
|--------------------------------------------------------------------------
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

$now = new DateTime();


/*
|--------------------------------------------------------------------------
| QR VERIFICATION
|--------------------------------------------------------------------------
*/

$qrData = $collected['QR'];

$scannedCode = $qrData['code'] ?? '';

if (
    empty($qrData['verified'])
    || !is_string($scannedCode)
    || $scannedCode === ''
) {

    checkin_response([
        'ok' => false,
        'message' =>
            'QR verification was not completed.'
    ], 422);
}


/*
 * IMPORTANT:
 * Never trust the "verified" flag by itself.
 * Compare the submitted code against the server's stored secret.
 */
if (!hash_equals(
    (string)$user['qr_secret'],
    $scannedCode
)) {

    checkin_response([
        'ok' => false,
        'message' =>
            'QR code does not match your digital badge. Please rescan.'
    ], 422);
}


$qrVerified = 1;
$methodsUsed[] = 'QR';


/*
|--------------------------------------------------------------------------
| GPS VERIFICATION
|--------------------------------------------------------------------------
*/

$gpsData = $collected['GPS'];

if (
    !isset($gpsData['lat'])
    || !isset($gpsData['lng'])
    || !is_numeric($gpsData['lat'])
    || !is_numeric($gpsData['lng'])
) {

    checkin_response([
        'ok' => false,
        'message' =>
            'GPS verification was not completed.'
    ], 422);
}


$gpsLat = (float)$gpsData['lat'];
$gpsLng = (float)$gpsData['lng'];


/*
 * Basic coordinate validation.
 */
if (
    $gpsLat < -90 ||
    $gpsLat > 90 ||
    $gpsLng < -180 ||
    $gpsLng > 180
) {

    checkin_response([
        'ok' => false,
        'message' =>
            'Invalid GPS coordinates were submitted.'
    ], 422);
}


if ($session) {

    /*
     * Course/session-specific geofence.
     */
    $distance = (int)round(
        gps_distance_meters(
            $gpsLat,
            $gpsLng,
            (float)$session['latitude'],
            (float)$session['longitude']
        )
    );


    if (
        $distance >
        (int)$session['radius_m']
    ) {

        $status = 'geofence_violation';
    }

} else {

    /*
     * Normal shift attendance without a course session.
     */
    $nearest = find_nearest_geofence(
        $conn,
        $gpsLat,
        $gpsLng
    );


    if (
        isset($nearest['geofence'])
        && $nearest['geofence']
    ) {

        $geofenceId =
            (int)$nearest['geofence']['id'];

        $distance =
            (int)round($nearest['distance']);


        if (!$nearest['within']) {
            $status = 'geofence_violation';
        }
    }
}


$methodsUsed[] = 'GPS';


/*
|--------------------------------------------------------------------------
| FACE VERIFICATION
|--------------------------------------------------------------------------
*/

$faceData = $collected['FACE'];

$descriptor =
    $faceData['descriptor'] ?? null;

$methodsUsed[] = 'FACE';


/*
 * If the user is enrolled, a descriptor is required.
 */
if (!empty($user['face_enrolled'])) {

    if (
        !is_array($descriptor)
        || count($descriptor) !== 128
    ) {

        checkin_response([
            'ok' => false,
            'message' =>
                'Face verification was not completed correctly.'
        ], 422);
    }


    if (empty($user['face_template'])) {

        checkin_response([
            'ok' => false,
            'message' =>
                'Your face is marked as enrolled, but no face template was found.'
        ], 422);
    }


    $storedTemplate =
        json_decode(
            $user['face_template'],
            true
        );


    if (
        !is_array($storedTemplate)
        || count($storedTemplate) !== 128
    ) {

        checkin_response([
            'ok' => false,
            'message' =>
                'Your stored face template is invalid.'
        ], 500);
    }


    $faceDistance =
        face_euclidean_distance(
            $storedTemplate,
            $descriptor
        );


    $faceMatch =
        face_distance_to_percent(
            $faceDistance
        );


    $threshold =
        (float)get_setting(
            'face_distance_threshold',
            0.6
        );


    if ($faceDistance > $threshold) {

        /*
         * Don't overwrite a more serious status.
         * The status remains geofence_violation if GPS already failed.
         */
        if ($status === 'on_time') {
            $status = 'face_mismatch';
        }
    }


} else {

    /*
     * User has no enrolled face.
     *
     * This follows your existing intended behavior:
     * attendance proceeds and face score remains N/A.
     */
    $faceMatch = null;
}


/*
|--------------------------------------------------------------------------
| FINGERPRINT
|--------------------------------------------------------------------------
*/

$fingerprintData =
    $collected['FINGERPRINT'];


/*
 * The current fingerprint implementation is simulated.
 * We still require the verified flag to be present.
 */
if (
    empty($fingerprintData['verified'])
) {

    checkin_response([
        'ok' => false,
        'message' =>
            'Fingerprint verification was not completed.'
    ], 422);
}


$fingerprintVerified = 1;

$methodsUsed[] = 'FINGERPRINT';


/*
|--------------------------------------------------------------------------
| TIME STATUS
|--------------------------------------------------------------------------
|
| For a course session, lateness should be determined from starts_at,
| not ends_at.
|
*/

$graceMinutes =
    (int)get_setting(
        'grace_period_minutes',
        15
    );


if ($session) {

    /*
     * Determine lateness relative to the session start.
     */
    $sessionStart =
        new DateTime(
            $session['starts_at']
        );


    $lateAfter =
        clone $sessionStart;


    $lateAfter->modify(
        '+' . $graceMinutes . ' minutes'
    );


    if (
        $now > $lateAfter
        && $status === 'on_time'
    ) {

        $status = 'late';
    }

} else {

    /*
     * Normal shift attendance.
     */
    $timeStatus =
        compute_time_status(
            $user['shift_start'],
            $graceMinutes,
            $now
        );


    if (
        $status === 'on_time'
        && $timeStatus === 'late'
    ) {

        $status = 'late';
    }
}


/*
|--------------------------------------------------------------------------
| METHODS STRING
|--------------------------------------------------------------------------
*/

$methodsStr =
    implode(
        ',',
        $methodsUsed
    );


/*
|--------------------------------------------------------------------------
| SESSION ID
|--------------------------------------------------------------------------
*/

$storedSessionId =
    $sessionId > 0
        ? $sessionId
        : null;


/*
|--------------------------------------------------------------------------
| DATABASE TRANSACTION
|--------------------------------------------------------------------------
*/

$conn->begin_transaction();


try {

    /*
     * IMPORTANT:
     *
     * The INSERT must actually succeed before we tell the
     * frontend that attendance was recorded.
     */
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

        throw new Exception(
            'Insert prepare failed: ' .
            $conn->error
        );
    }


    $checkInStr =
        $now->format(
            'Y-m-d H:i:s'
        );


    /*
     * 12 values:
     *
     * i  user_id
     * i  session_id
     * i  geofence_id
     * s  check_in_time
     * s  status
     * s  methods_used
     * d  gps_lat
     * d  gps_lng
     * d  gps_distance
     * d  face_match
     * i  qr_verified
     * i  fingerprint_verified
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

        throw new Exception(
            'Insert execute failed: ' .
            $stmt->error
        );
    }


    /*
     * Make absolutely sure a row was actually created.
     */
    if ($stmt->affected_rows !== 1) {

        throw new Exception(
            'Attendance INSERT did not create a row.'
        );
    }


    $attendanceId =
        $stmt->insert_id;


    $stmt->close();


    /*
     * Everything succeeded.
     */
    $conn->commit();


} catch (Throwable $e) {

    /*
     * Undo anything from this request.
     */
    $conn->rollback();


    /*
     * Log the REAL database error.
     * Do not expose raw SQL errors to students.
     */
    error_log(
        'CHECK-IN INSERT ERROR: ' .
        $e->getMessage()
    );


    checkin_response([
        'ok' => false,
        'message' =>
            'Attendance could not be recorded. Please try again.'
    ], 500);
}


/*
|--------------------------------------------------------------------------
| SUCCESS RESPONSE
|--------------------------------------------------------------------------
|
| We only reach this point AFTER the database INSERT succeeded.
|--------------------------------------------------------------------------
*/

checkin_response([
    'ok' => true,

    'attendance_id' =>
        $attendanceId,

    'status' =>
        $status,

    'status_label' =>
        badge_label($status),

    'time' =>
        $now->format(
            'n/j/Y, g:i:s A'
        ),

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