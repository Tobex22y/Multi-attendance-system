<?php
require_once __DIR__ . '/../../includes/auth.php';

$user = current_user();

if (!$user) {
    json_response(['authenticated' => false]);
}

json_response(['authenticated' => true, 'user' => public_user($user)]);
