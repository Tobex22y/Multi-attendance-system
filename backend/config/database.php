<?php
/**
 * Database connection.
 * Edit these four constants to match your XAMPP / MySQL setup.
 */
define('DB_HOST', '127.0.0.1');
define('DB_NAME', 'multi_auth_attendance');
define('DB_USER', 'root');
define('DB_PASS', '');

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $conn = mysqli_init();
    $conn->options(MYSQLI_OPT_CONNECT_TIMEOUT, 5);
    $conn->real_connect(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $conn->set_charset('utf8mb4');
} catch (mysqli_sql_exception $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'authenticated' => false,
        'message' => 'Database connection failed: ' . $e->getMessage() .
            '. Make sure MySQL is running and you have imported database/schema.sql',
    ]);
    exit;
}
