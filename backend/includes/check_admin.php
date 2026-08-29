<?php
/**
 * TEMPORARY DIAGNOSTIC SCRIPT — delete after use.
 *
 * Visit this once in your browser after uploading it to the SAME folder
 * as seed_helper.php (backend/includes/), e.g.:
 *   https://multi-attendance-system.onrender.com/backend/includes/check_admin.php
 *
 * It shows exactly what's stored in the database for admin@tech.com,
 * and tests password_verify() against a few likely passwords so we can
 * see precisely why login is failing.
 */
require_once __DIR__ . '/../config/database.php';

header('Content-Type: text/html');

$stmt = $conn->prepare('SELECT id, email, password_hash, role FROM users WHERE email LIKE ?');
$like = '%tech.com%';
$stmt->bind_param('s', $like);
$stmt->execute();
$result = $stmt->get_result();

echo "<h3>Users matching '%tech.com%':</h3>";
$found = false;
while ($row = $result->fetch_assoc()) {
    $found = true;
    echo "<pre>";
    echo "id: " . htmlspecialchars($row['id']) . "\n";
    echo "email (exact, quoted): '" . htmlspecialchars($row['email']) . "'\n";
    echo "role: " . htmlspecialchars($row['role']) . "\n";
    echo "password_hash: " . htmlspecialchars($row['password_hash']) . "\n";
    echo "hash looks like valid bcrypt: " . (preg_match('/^\$2[axy]\$/', $row['password_hash']) ? "YES" : "NO — this is the problem if NO") . "\n";

    foreach (['admin', 'Password123!', 'password', 'Admin123!'] as $testPassword) {
        $matches = password_verify($testPassword, $row['password_hash']);
        echo "password_verify('$testPassword', hash) => " . ($matches ? "TRUE  <-- this password works" : "false") . "\n";
    }
    echo "</pre><hr>";
}

if (!$found) {
    echo "<p>No users found matching '%tech.com%' at all. The seed data itself may not have imported, or the email is completely different than expected.</p>";
    echo "<h3>Showing first 5 users in the table instead:</h3>";
    $result2 = $conn->query('SELECT id, email, role FROM users LIMIT 5');
    echo "<pre>";
    while ($row = $result2->fetch_assoc()) {
        echo "id: {$row['id']} | email: '{$row['email']}' | role: {$row['role']}\n";
    }
    echo "</pre>";
}

echo "<p><strong>Delete this file after use.</strong></p>";
