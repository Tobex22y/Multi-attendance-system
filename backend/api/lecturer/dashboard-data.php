<?php
require_once __DIR__ . '/../../includes/auth.php';
require_once __DIR__ . '/../../includes/functions.php';

$user = require_lecturer();

$sessionSql = 'SELECT s.*, COUNT(al.id) AS attendance_count
    FROM attendance_sessions s
    LEFT JOIN attendance_logs al ON al.session_id = s.id';

if ($user['role'] !== 'admin') {
    $sessionSql .= ' WHERE s.created_by = ?';
}

$sessionSql .= ' GROUP BY s.id ORDER BY s.starts_at DESC LIMIT 50';

$stmt = $conn->prepare($sessionSql);
if ($user['role'] !== 'admin') {
    $stmt->bind_param('i', $user['id']);
}
$stmt->execute();
$sessions = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$logSql = 'SELECT al.*, u.full_name, u.user_code, u.role, u.department, u.photo_path, s.course_code, s.course_name
     FROM attendance_logs al
     JOIN users u ON u.id = al.user_id
     LEFT JOIN attendance_sessions s ON s.id = al.session_id';

if ($user['role'] !== 'admin') {
    $logSql .= ' WHERE s.created_by = ?';
}

$logSql .= ' ORDER BY al.check_in_time DESC LIMIT 100';

$logStmt = $conn->prepare($logSql);
if ($user['role'] !== 'admin') {
    $logStmt->bind_param('i', $user['id']);
}
$logStmt->execute();
$logs = $logStmt->get_result()->fetch_all(MYSQLI_ASSOC);
$logs = array_map('attach_badge', $logs);

json_response([
    'user' => public_user($user),
    'sessions' => $sessions,
    'logs' => $logs,
]);
