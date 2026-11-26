<?php
declare(strict_types=1);

// Copy this file to config.php outside the public web root and replace every
// placeholder. Never commit or download the resulting config.php.
return [
    'database' => [
        'dsn' => 'mysql:host=YOUR_DB_HOST;dbname=YOUR_DB_NAME;charset=utf8mb4',
        'user' => 'YOUR_DB_USER',
        'password' => 'YOUR_DB_PASSWORD',
    ],
    // 32 random bytes, Base64 encoded. Generate it only in the local setup page.
    'encryption_key_base64' => 'REPLACE_WITH_32_BYTE_BASE64_KEY',
    'timezone' => 'Europe/Berlin',
];
