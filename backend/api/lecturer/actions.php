<?php
require_once __DIR__ . '/../../includes/auth.php';
require_once __DIR__ . '/../../includes/functions.php';

$lecturer = require_lecturer();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['success' => false, 'message' => 'Method not allowed.'], 405);
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $body['action'] ?? '';

switch ($action) {
    case 'create_attendance_session': {
        $courseCode = trim($body['course_code'] ?? '');
        $courseName = trim($body['course_name'] ?? '');
        $startsAt = str_replace('T', ' ', trim($body['starts_at'] ?? ''));
        $endsAt = str_replace('T', ' ', trim($body['ends_at'] ?? ''));
        $latitude = (float)($body['latitude'] ?? 0);
        $longitude = (float)($body['longitude'] ?? 0);
        $radius = max(10, (int)($body['radius_m'] ?? 100));

        if ($courseCode === '' || $courseName === '' || $startsAt === '' || $endsAt === '') {
            json_response(['success' => false, 'message' => 'Course code, course name, start time, and end time are required.'], 422);
        }
        if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
            json_response(['success' => false, 'message' => 'Choose a valid GPS location.'], 422);
        }
        if (strtotime($endsAt) <= strtotime($startsAt)) {
            json_response(['success' => false, 'message' => 'End time must be after start time.'], 422);
        }

        $stmt = $conn->prepare(
            'INSERT INTO attendance_sessions
             (course_code, course_name, starts_at, ends_at, latitude, longitude, radius_m, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->bind_param('ssssddii', $courseCode, $courseName, $startsAt, $endsAt, $latitude, $longitude, $radius, $lecturer['id']);
        $stmt->execute();

        json_response(['success' => true, 'session_id' => $stmt->insert_id]);
    }

    case 'close_attendance_session': {
        $sessionId = (int)($body['session_id'] ?? 0);
        if (!$sessionId) {
            json_response(['success' => false, 'message' => 'A session id is required.'], 422);
        }

        $checkStmt = $conn->prepare('SELECT created_by FROM attendance_sessions WHERE id = ? LIMIT 1');
        $checkStmt->bind_param('i', $sessionId);
        $checkStmt->execute();
        $sessionRow = $checkStmt->get_result()->fetch_assoc();

        if (!$sessionRow) {
            json_response(['success' => false, 'message' => 'Attendance session not found.'], 404);
        }

        if ($lecturer['role'] !== 'admin' && (int)$sessionRow['created_by'] !== (int)$lecturer['id']) {
            json_response(['success' => false, 'message' => 'You can only close your own attendance sessions.'], 403);
        }

        $stmt = $conn->prepare('UPDATE attendance_sessions SET is_active = 0 WHERE id = ?');
        $stmt->bind_param('i', $sessionId);
        $stmt->execute();
        json_response(['success' => true]);
    }

    case 'generate_attendance_qr': {
        $sessionId = (int)($body['session_id'] ?? 0);

        if (!$sessionId) {
            json_response([
                'success' => false,
                'message' => 'A session id is required.'
            ], 422);
        }

        /*
        * Make sure the session exists.
        */
        $checkStmt = $conn->prepare(
            'SELECT
                id,
                created_by,
                is_active,
                starts_at,
                ends_at
            FROM attendance_sessions
            WHERE id = ?
            LIMIT 1'
        );

        if (!$checkStmt) {
            json_response([
                'success' => false,
                'message' => 'Database error while checking attendance session.'
            ], 500);
        }

        $checkStmt->bind_param('i', $sessionId);

        if (!$checkStmt->execute()) {
            json_response([
                'success' => false,
                'message' => 'Unable to check attendance session.'
            ], 500);
        }

        $session = $checkStmt->get_result()->fetch_assoc();

        if (!$session) {
            json_response([
                'success' => false,
                'message' => 'Attendance session not found.'
            ], 404);
        }

        /*
        * Only the lecturer who created the session can generate
        * its QR code. Admins are also allowed.
        */
        if (
            $lecturer['role'] !== 'admin' &&
            (int)$session['created_by'] !== (int)$lecturer['id']
        ) {
            json_response([
                'success' => false,
                'message' => 'You can only generate QR codes for your own attendance sessions.'
            ], 403);
        }

        /*
        * Make sure the session is active.
        */
        if ((int)$session['is_active'] !== 1) {
            json_response([
                'success' => false,
                'message' => 'This attendance session is closed.'
            ], 422);
        }

        /*
        * Check actual session time using Lagos time.
        */
        $now = new DateTime(
            'now',
            new DateTimeZone('Africa/Lagos')
        );

        $sessionStart = new DateTime(
            $session['starts_at'],
            new DateTimeZone('Africa/Lagos')
        );

        $sessionEnd = new DateTime(
            $session['ends_at'],
            new DateTimeZone('Africa/Lagos')
        );

        if ($now < $sessionStart) {
            json_response([
                'success' => false,
                'message' => 'This attendance session has not started yet.'
            ], 422);
        }

        if ($now > $sessionEnd) {
            json_response([
                'success' => false,
                'message' => 'This attendance session has already ended.'
            ], 422);
        }

        /*
        * Generate a brand-new cryptographically secure token.
        *
        * Every click creates a new token.
        */
        $token = bin2hex(random_bytes(32));

        /*
        * Store only the SHA-256 hash.
        */
        $tokenHash = hash('sha256', $token);

        /*
        * QR remains valid for 60 seconds.
        */
        $expiresAt = clone $now;
        $expiresAt->modify('+60 seconds');

        /*
        * Invalidate all previous QR tokens for this session.
        */
        $deleteStmt = $conn->prepare(
            'DELETE FROM attendance_qr_tokens
            WHERE session_id = ?'
        );

        if (!$deleteStmt) {
            json_response([
                'success' => false,
                'message' => 'Database error while replacing QR token.'
            ], 500);
        }

        $deleteStmt->bind_param('i', $sessionId);
        $deleteStmt->execute();

        /*
        * Store the new token.
        */
        $insertStmt = $conn->prepare(
            'INSERT INTO attendance_qr_tokens
            (session_id, token_hash, expires_at)
            VALUES (?, ?, ?)'
        );

        if (!$insertStmt) {
            json_response([
                'success' => false,
                'message' => 'Database error while creating QR token.'
            ], 500);
        }

        $expiresString = $expiresAt->format('Y-m-d H:i:s');

        $insertStmt->bind_param(
            'iss',
            $sessionId,
            $tokenHash,
            $expiresString
        );

        if (!$insertStmt->execute()) {
            json_response([
                'success' => false,
                'message' => 'Unable to create QR token.'
            ], 500);
        }

        json_response([
            'success' => true,
            'session_id' => $sessionId,
            'token' => $token,
            'expires_at' => $expiresAt->format('Y-m-d H:i:s'),
            'expires_in' => 60
        ]);
    }

    default:
        json_response(['success' => false, 'message' => 'Unknown action.'], 400);
}
