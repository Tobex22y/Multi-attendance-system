<?php
require_once __DIR__ . '/../../includes/auth.php';
require_once __DIR__ . '/../../includes/functions.php';

$admin = require_admin();

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
            json_response(['success' => false, 'message' => 'Course, name, start time, and end time are required.'], 422);
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
        $stmt->bind_param('ssssddii', $courseCode, $courseName, $startsAt, $endsAt, $latitude, $longitude, $radius, $admin['id']);
        $stmt->execute();
        json_response(['success' => true, 'session_id' => $stmt->insert_id]);
    }

    case 'close_attendance_session': {
        $sessionId = (int)($body['session_id'] ?? 0);
        if (!$sessionId) {
            json_response(['success' => false, 'message' => 'A session id is required.'], 422);
        }
        $stmt = $conn->prepare('UPDATE attendance_sessions SET is_active = 0 WHERE id = ?');
        $stmt->bind_param('i', $sessionId);
        $stmt->execute();
        json_response(['success' => true]);
    }

    case 'update_settings': {
        $requireMfa = !empty($body['require_mfa']) ? '1' : '0';
        $grace = max(0, (int)($body['grace_period_minutes'] ?? 15));
        $stmt = $conn->prepare('UPDATE settings SET setting_value = ? WHERE setting_key = "require_mfa"');
        $stmt->bind_param('s', $requireMfa);
        $stmt->execute();
        $stmt = $conn->prepare('UPDATE settings SET setting_value = ? WHERE setting_key = "grace_period_minutes"');
        $stmt->bind_param('s', $grace);
        $stmt->execute();
        json_response(['success' => true]);
    }

    case 'add_geofence': {
        $name = trim($body['name'] ?? '');
        $address = trim($body['address'] ?? '');
        $lat = (float)($body['latitude'] ?? 0);
        $lng = (float)($body['longitude'] ?? 0);
        $radius = max(10, (int)($body['radius_m'] ?? 150));
        if ($name === '' || $address === '') {
            json_response(['success' => false, 'message' => 'Name and address are required.'], 422);
        }
        $stmt = $conn->prepare('INSERT INTO geofences (name, address, latitude, longitude, radius_m) VALUES (?,?,?,?,?)');
        $stmt->bind_param('ssddi', $name, $address, $lat, $lng, $radius);
        $stmt->execute();
        json_response(['success' => true]);
    }

    case 'review_leave': {
        $leaveId = (int)($body['leave_id'] ?? 0);
        $decision = in_array($body['decision'] ?? '', ['approved', 'rejected']) ? $body['decision'] : null;
        if (!$leaveId || !$decision) {
            json_response(['success' => false, 'message' => 'A leave id and decision are required.'], 422);
        }
        $stmt = $conn->prepare('UPDATE leave_requests SET status = ?, reviewed_by = ? WHERE id = ?');
        $stmt->bind_param('sii', $decision, $admin['id'], $leaveId);
        $stmt->execute();
        json_response(['success' => true]);
    }

    case 'enroll_user': {
        $fullName = trim($body['full_name'] ?? '');
        $email = trim($body['email'] ?? '');
        $role = in_array($body['role'] ?? '', ['employee', 'student', 'admin']) ? $body['role'] : 'employee';
        $department = trim($body['department'] ?? '');
        $password = $body['password'] ?? '';
        if ($fullName === '' || $email === '') {
            json_response(['success' => false, 'message' => 'Full name and email are required.'], 422);
        }
        if ($password !== '' && strlen($password) < 8) {
            json_response(['success' => false, 'message' => 'Password must be at least 8 characters.'], 422);
        }
        $check = $conn->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $check->bind_param('s', $email);
        $check->execute();
        if ($check->get_result()->num_rows > 0) {
            json_response(['success' => false, 'message' => 'An account with that email already exists.'], 409);
        }
        $prefix = $role === 'student' ? 'STU' : ($role === 'admin' ? 'ADM' : 'EMP');
        $userCode = $prefix . '-' . random_int(1000, 9999);
        $qrSecret = 'QR-' . strtoupper(bin2hex(random_bytes(8)));
        $createdPassword = $password !== '' ? $password : bin2hex(random_bytes(4));
        $hash = password_hash($createdPassword, PASSWORD_BCRYPT);
        $stmt = $conn->prepare(
            'INSERT INTO users (user_code, full_name, email, password_hash, role, department, qr_secret)
             VALUES (?,?,?,?,?,?,?)'
        );
        $stmt->bind_param('sssssss', $userCode, $fullName, $email, $hash, $role, $department, $qrSecret);
        $stmt->execute();
        json_response(['success' => true, 'user_code' => $userCode, 'password' => $password === '' ? $createdPassword : null]);
    }

    default:
        json_response(['success' => false, 'message' => 'Unknown action.'], 400);
}
