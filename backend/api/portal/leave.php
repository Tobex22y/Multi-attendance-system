<?php
require_once __DIR__ . '/../../includes/auth.php';

$user = require_login();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['success' => false, 'message' => 'Method not allowed.'], 405);
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$type = in_array($body['leave_type'] ?? '', ['sick', 'vacation', 'emergency', 'other']) ? $body['leave_type'] : 'other';
$reason = trim($body['reason'] ?? '');
$start = $body['start_date'] ?? '';
$end = $body['end_date'] ?? '';

if ($reason === '' || !$start || !$end) {
    json_response(['success' => false, 'message' => 'Please fill in reason, start date and end date.'], 422);
}

$stmt = $conn->prepare('INSERT INTO leave_requests (user_id, leave_type, reason, start_date, end_date) VALUES (?,?,?,?,?)');
$stmt->bind_param('issss', $user['id'], $type, $reason, $start, $end);
$stmt->execute();

json_response(['success' => true]);
