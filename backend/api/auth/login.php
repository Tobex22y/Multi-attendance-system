<?php
require_once __DIR__ . '/../../includes/auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['success' => false, 'message' => 'Method not allowed.'], 405);
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$email = trim($body['email'] ?? '');
$password = $body['password'] ?? '';

if ($email === '' || $password === '') {
    json_response(['success' => false, 'message' => 'Email and password are required.'], 422);
}

$stmt = $conn->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
$stmt->bind_param('s', $email);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();

if ($user && password_verify($password, $user['password_hash'])) {
    log_in_user($user);
    json_response([
        'success' => true,
        'role' => $user['role'],
        'redirect' => $user['role'] === 'admin' ? 'admin-dashboard.html' : 'portal.html',
    ]);
} else {
    json_response(['success' => false, 'message' => 'Invalid email or password.'], 401);
}
