<?php
/**
 * Database connection.
 * Local XAMPP is the default; deployments can override these with env vars.
 */
define('DB_HOST', getenv('DB_HOST') ?: getenv('MYSQLHOST') ?: '127.0.0.1');
define('DB_NAME', getenv('DB_NAME') ?: getenv('MYSQLDATABASE') ?: 'multi_auth_attendance');
define('DB_USER', getenv('DB_USER') ?: getenv('MYSQLUSER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: getenv('MYSQLPASSWORD') ?: '');
define('DB_PORT', (int)(getenv('DB_PORT') ?: getenv('MYSQLPORT') ?: 3306));
define('DB_SSL', getenv('DB_SSL') ?: (in_array(DB_HOST, ['127.0.0.1', 'localhost'], true) ? '0' : '1'));
define('DB_SSL_CA', getenv('DB_SSL_CA') ?: __DIR__ . '/ca.pem');

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $conn = mysqli_init();
    $conn->options(MYSQLI_OPT_CONNECT_TIMEOUT, 5);
    if (DB_SSL === '1') {
        if (!is_readable(DB_SSL_CA)) {
            throw new RuntimeException('Database CA certificate is missing or unreadable.');
        }

        $conn->ssl_set(null, null, DB_SSL_CA, null, null);
        if (defined('MYSQLI_OPT_SSL_VERIFY_SERVER_CERT')) {
            $conn->options(MYSQLI_OPT_SSL_VERIFY_SERVER_CERT, true);
        }
        $conn->real_connect(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT, null, MYSQLI_CLIENT_SSL);
    } else {
        $conn->real_connect(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT);
    }
    $conn->set_charset('utf8mb4');
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'authenticated' => false,
        'message' => 'Database connection failed: ' . $e->getMessage() .
            '. On Render, set DB_HOST, DB_NAME, DB_USER, DB_PASS, and DB_PORT to an external MySQL/MariaDB database and import database/schema.sql.',
    ]);
    exit;
}
