<?php
require_once __DIR__ . '/../config/database.php';

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json');

/** Send a JSON response and stop execution. */
function json_response(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

/** Fetch the logged-in user's row, or null if nobody is logged in. */
function current_user(): ?array {
    global $conn;
    static $cached = null;
    static $checked = false;
    if ($checked) return $cached;
    $checked = true;

    if (empty($_SESSION['user_id'])) {
        return null;
    }

    $stmt = $conn->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    $stmt->bind_param('i', $_SESSION['user_id']);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    $cached = $result ?: null;
    return $cached;
}

/** Require any logged-in user. Sends a 401 JSON response and stops if not logged in. */
function require_login(): array {
    $user = current_user();
    if (!$user) {
        json_response(['authenticated' => false, 'message' => 'Not logged in.'], 401);
    }
    return $user;
}

/** Require an admin. Sends a 403 JSON response and stops otherwise. */
function require_admin(): array {
    $user = require_login();
    if ($user['role'] !== 'admin') {
        json_response(['message' => 'Admin access required.'], 403);
    }
    return $user;
}

function log_in_user(array $user): void {
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['role']    = $user['role'];
}

function get_setting(string $key, $default = null) {
    global $conn;
    $stmt = $conn->prepare('SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1');
    $stmt->bind_param('s', $key);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return $row ? $row['setting_value'] : $default;
}

/** Strip fields that should never be sent to the browser. */
function public_user(array $user): array {
    unset($user['password_hash'], $user['face_template']);
    return $user;
}
