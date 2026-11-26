<?php
declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use GymProgressApi\JsonResponse;
use GymProgressApi\Request;

Request::requireMethod('GET');
try {
    $pdo->query('SELECT 1');
    JsonResponse::send(200, ['schema_version' => 1, 'status' => 'ok']);
} catch (Throwable) {
    JsonResponse::error(503, 'DATABASE_UNAVAILABLE', 'Der Datenspeicher ist nicht erreichbar.');
}
