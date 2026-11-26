<?php
declare(strict_types=1);

$candidates = [];
$configured = getenv('GYMPROGRESS_API_BOOTSTRAP');
if (is_string($configured) && $configured !== '') {
    $candidates[] = $configured;
}
if (isset($_SERVER['DOCUMENT_ROOT'])) {
    $candidates[] = rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/\\') . '/../private/gymprogress-api/bootstrap.php';
    $candidates[] = rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/\\') . '/private/gymprogress-api/bootstrap.php';
}
$candidates[] = dirname(__DIR__, 4) . '/private/bootstrap.php';

foreach ($candidates as $candidate) {
    if (is_file($candidate)) {
        require $candidate;
        return;
    }
}

http_response_code(503);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo '{"schema_version":1,"error":{"code":"BOOTSTRAP_NOT_FOUND","message":"Die API ist noch nicht bereitgestellt."}}';
exit;
