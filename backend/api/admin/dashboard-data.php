<?php
require_once __DIR__ . '/../../includes/auth.php';
require_once __DIR__ . '/../../includes/functions.php';

$admin = require_admin();

// ---- Stats ----
$totalUsers = $conn->query("SELECT COUNT(*) c FROM users")->fetch_assoc()['c'];
$today = date('Y-m-d');
$todayLogs = $conn->query("SELECT * FROM attendance_logs WHERE DATE(check_in_time) = '$today'")->fetch_all(MYSQLI_ASSOC);
$onTimeCount = count(array_filter($todayLogs, fn($l) => $l['status'] === 'on_time'));
$lateCount = count(array_filter($todayLogs, fn($l) => $l['status'] === 'late'));
$violationCount = count(array_filter($todayLogs, fn($l) => $l['status'] === 'geofence_violation'));
$targetRate = $totalUsers > 0 ? round(($onTimeCount / $totalUsers) * 100) : 0;

// ---- Real-time logs (joined with users) ----
$logs = $conn->query(
  "SELECT al.*, u.full_name, u.user_code, u.role, u.department, u.photo_path
   FROM attendance_logs al JOIN users u ON u.id = al.user_id
   ORDER BY al.check_in_time DESC LIMIT 100"
)->fetch_all(MYSQLI_ASSOC);
$logs = array_map('attach_badge', $logs);

// ---- Users directory ----
$allUsers = $conn->query(
  "SELECT id, user_code, full_name, email, role, department, photo_path, qr_secret, face_enrolled, fingerprint_enrolled
   FROM users ORDER BY role='admin' DESC, full_name ASC"
)->fetch_all(MYSQLI_ASSOC);

// ---- Geofences ----
$geofences = $conn->query("SELECT * FROM geofences ORDER BY id ASC")->fetch_all(MYSQLI_ASSOC);
$sessions = $conn->query(
  "SELECT s.*, COUNT(al.id) AS attendance_count
   FROM attendance_sessions s
   LEFT JOIN attendance_logs al ON al.session_id = s.id
   GROUP BY s.id ORDER BY s.starts_at DESC LIMIT 50"
)->fetch_all(MYSQLI_ASSOC);
$requireMfa = get_setting('require_mfa', '1');
$graceMinutes = get_setting('grace_period_minutes', '15');

// ---- Leave requests ----
$leaves = $conn->query(
  "SELECT lr.*, u.full_name, u.user_code FROM leave_requests lr
   JOIN users u ON u.id = lr.user_id ORDER BY lr.status='pending' DESC, lr.created_at DESC"
)->fetch_all(MYSQLI_ASSOC);
$pendingLeaveCount = count(array_filter($leaves, fn($l) => $l['status'] === 'pending'));

json_response([
    'admin' => public_user($admin),
    'stats' => [
        'total_users' => (int)$totalUsers,
        'on_time_count' => $onTimeCount,
        'late_count' => $lateCount,
        'violation_count' => $violationCount,
        'target_rate' => $targetRate,
    ],
    'logs' => $logs,
    'users' => $allUsers,
    'geofences' => $geofences,
    'sessions' => $sessions,
    'settings' => [
        'require_mfa' => $requireMfa,
        'grace_period_minutes' => $graceMinutes,
    ],
    'leaves' => $leaves,
    'pending_leave_count' => $pendingLeaveCount,
]);
