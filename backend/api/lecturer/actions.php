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

    default:
        json_response(['success' => false, 'message' => 'Unknown action.'], 400);
}
