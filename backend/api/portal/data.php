<?php
require_once __DIR__ . '/../../includes/auth.php';
require_once __DIR__ . '/../../includes/functions.php';

$user = require_login();

$stmt = $conn->prepare(
    'SELECT al.*, s.course_code, s.course_name
     FROM attendance_logs al
     LEFT JOIN attendance_sessions s ON s.id = al.session_id
     WHERE al.user_id = ? ORDER BY al.check_in_time DESC'
);
$stmt->bind_param('i', $user['id']);
$stmt->execute();
$logs = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$logs = array_map('attach_badge', $logs);

$total = count($logs);
$onTime = count(array_filter($logs, fn($l) => $l['status'] === 'on_time'));
$late = count(array_filter($logs, fn($l) => $l['status'] === 'late'));
$punctuality = $total > 0 ? round(($onTime / $total) * 100) : 100;

$stmt = $conn->prepare('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC');
$stmt->bind_param('i', $user['id']);
$stmt->execute();
$myLeaves = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$stmt = $conn->prepare(
        'SELECT s.*, EXISTS(
             SELECT 1 FROM attendance_logs al WHERE al.session_id = s.id AND al.user_id = ?
         ) AS already_marked
         FROM attendance_sessions s
         WHERE s.is_active = 1 AND s.starts_at <= NOW() AND s.ends_at >= NOW()
         ORDER BY s.starts_at ASC'
);
$stmt->bind_param('i', $user['id']);
$stmt->execute();
$sessions = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$portalUser = public_user($user);
unset($portalUser['qr_secret']);

json_response([
    'user' => $portalUser,
    'stats' => [
        'total' => $total,
        'on_time' => $onTime,
        'late' => $late,
        'punctuality' => $punctuality,
    ],
    'logs' => $logs,
    'sessions' => $sessions,
    'leaves' => $myLeaves,
]);
