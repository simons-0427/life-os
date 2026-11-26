<?php
declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use GymProgressApi\JsonResponse;
use GymProgressApi\Request;
use GymProgressApi\Validation;

Request::requireMethod('GET');
$context = $auth->requireScope(Request::apiKey(), 'read');
try {
    [$from, $to] = Validation::dateRange($_GET['from'] ?? null, $_GET['to'] ?? null);
    JsonResponse::send(200, [
        'schema_version' => 1,
        'from' => $from,
        'to' => $to,
        'records' => $repository->fetch($context->accountId, $from, $to),
        'server_time' => date(DATE_ATOM),
    ]);
} catch (InvalidArgumentException $error) {
    JsonResponse::error(422, 'INVALID_RANGE', $error->getMessage());
} catch (Throwable) {
    JsonResponse::error(500, 'READ_FAILED', 'Die Daten konnten nicht gelesen werden.');
}
