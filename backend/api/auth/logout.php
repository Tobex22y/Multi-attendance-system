<?php
require_once __DIR__ . '/../../includes/auth.php';

$_SESSION = [];
session_destroy();

json_response(['success' => true]);
