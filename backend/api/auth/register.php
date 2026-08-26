<?php
require_once __DIR__ . '/../../includes/auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['success' => false, 'message' => 'Method not allowed.'], 405);
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$fullName = trim($body['full_name'] ?? '');
$email = trim($body['email'] ?? '');
$password = $body['password'] ?? '';
$role = in_array($body['role'] ?? '', ['employee', 'student']) ? $body['role'] : 'employee';
$department = trim($body['department'] ?? '');
$faceDescriptorRaw = $body['face_descriptor'] ?? '';

if ($fullName === '' || $email === '') {
    json_response(['success' => false, 'message' => 'Full name and email are required.'], 422);
}
if (strlen($password) < 8) {
    json_response(['success' => false, 'message' => 'Password must be at least 8 characters.'], 422);
}

$check = $conn->prepare('SELECT id FROM users WHERE email = ?');
$check->bind_param('s', $email);
$check->execute();
if ($check->get_result()->num_rows > 0) {
    json_response(['success' => false, 'message' => 'An account with that email already exists.'], 409);
}

$prefix = $role === 'student' ? 'STU' : 'EMP';
$userCode = $prefix . '-' . random_int(1000, 9999);
$qrSecret = 'QR-' . strtoupper(bin2hex(random_bytes(8)));
$hash = password_hash($password, PASSWORD_BCRYPT);

// Face descriptor captured client-side via face-api.js (128 floats, JSON-encoded).
// Registration proceeds even without one — the user can enroll a face later.
$faceTemplate = null;
$faceEnrolled = 0;
$decoded = json_decode($faceDescriptorRaw, true);
$validFaceDescriptor = is_array($decoded) && count($decoded) === 128;
if ($validFaceDescriptor) {
    foreach ($decoded as $value) {
        if (!is_numeric($value) || !is_finite((float)$value)) {
            $validFaceDescriptor = false;
            break;
        }
    }
}
if ($validFaceDescriptor) {
    $faceTemplate = json_encode($decoded);
    $faceEnrolled = 1;
}

$stmt = $conn->prepare(
    'INSERT INTO users (user_code, full_name, email, password_hash, role, department, qr_secret, face_template, face_enrolled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
$stmt->bind_param('ssssssssi', $userCode, $fullName, $email, $hash, $role, $department, $qrSecret, $faceTemplate, $faceEnrolled);
$stmt->execute();

log_in_user(['id' => $stmt->insert_id, 'role' => $role]);

json_response(['success' => true, 'redirect' => 'portal.html']);
