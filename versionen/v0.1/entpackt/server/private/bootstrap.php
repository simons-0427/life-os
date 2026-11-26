<?php
declare(strict_types=1);

require_once __DIR__ . '/src/JsonResponse.php';
require_once __DIR__ . '/src/Request.php';
require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Auth.php';
require_once __DIR__ . '/src/Crypto.php';
require_once __DIR__ . '/src/Validation.php';
require_once __DIR__ . '/src/ObservationRepository.php';

use GymProgressApi\Auth;
use GymProgressApi\Crypto;
use GymProgressApi\Database;
use GymProgressApi\JsonResponse;
use GymProgressApi\ObservationRepository;
use GymProgressApi\Request;

date_default_timezone_set('Europe/Berlin');
JsonResponse::securityHeaders();

$configPath = getenv('GYMPROGRESS_API_CONFIG');
if (!is_string($configPath) || $configPath === '') {
    $configPath = __DIR__ . '/config.php';
}
if (!is_file($configPath)) {
    JsonResponse::error(503, 'API_NOT_CONFIGURED', 'Die API ist noch nicht konfiguriert.');
}
$config = require $configPath;
if (!is_array($config)) {
    JsonResponse::error(503, 'INVALID_CONFIG', 'Die API-Konfiguration ist ungültig.');
}

Request::requireHttps();
$pdo = Database::connect($config['database'] ?? []);
$crypto = new Crypto((string) ($config['encryption_key_base64'] ?? ''));
$auth = new Auth($pdo);
$repository = new ObservationRepository($pdo, $crypto);
