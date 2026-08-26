<?php
/**
 * Database connection.
 * Database settings for the hosted MySQL server.
 */
define('DB_HOST', 'sql3.freesqldatabase.com');
define('DB_NAME', 'sql3836021');
define('DB_USER', 'sql3836021');
define('DB_PASS', '3yflGFSW24');
define('DB_PORT', 3306);

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $conn = mysqli_init();
    $conn->options(MYSQLI_OPT_CONNECT_TIMEOUT, 5);
    $conn->real_connect(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT);
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
