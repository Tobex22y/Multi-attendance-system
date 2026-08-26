<?php
/**
 * Run this ONCE in the browser after importing database/schema.sql:
 *   http://localhost/multi-auth-attendance/backend/includes/seed_helper.php
 *
 * The schema.sql file ships with placeholder password hashes that will not log in.
 * This sets real, working bcrypt hashes:
 *   - admin@tech.com  -> password: admin
 *   - every other seeded demo account -> password: Password123!
 * Delete this file after running it once in production.
 */
require_once __DIR__ . '/../config/database.php';

header('Content-Type: text/html');

$adminPassword = 'admin';
$demoPassword = 'Password123!';

$adminHash = password_hash($adminPassword, PASSWORD_BCRYPT);
$demoHash = password_hash($demoPassword, PASSWORD_BCRYPT);

$adminEmail = 'admin@tech.com';

$stmt = $conn->prepare('UPDATE users SET password_hash = ? WHERE email = ?');
$stmt->bind_param('ss', $adminHash, $adminEmail);
$stmt->execute();

$stmt = $conn->prepare('UPDATE users SET password_hash = ? WHERE email != ?');
$stmt->bind_param('ss', $demoHash, $adminEmail);
$stmt->execute();

echo "Done.<br>";
echo "Admin sign-in: <b>{$adminEmail}</b> / <b>{$adminPassword}</b><br>";
echo "All other seeded demo accounts now use the password: <b>{$demoPassword}</b><br>";
echo "Sign in at <a href='../../frontend/html/index.html'>/frontend/html/index.html</a>.";
