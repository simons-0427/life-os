<?php
declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use GymProgressApi\JsonResponse;
use GymProgressApi\Request;
use GymProgressApi\Validation;

Request::requireMethod('POST');
$context = $auth->requireScope(Request::apiKey(), 'write');
try {
    $batch = Validation::upload(Request::jsonBody());
    $manualAck = $repository->ingest($context->accountId, $batch->records, $batch->manualDays);
    $accepted = count($batch->records);
    foreach ($batch->manualDays as $manual) {
        $accepted += count($manual['records']);
    }
    JsonResponse::send(200, [
        'schema_version' => 1,
        'accepted' => $accepted,
        'manual_ack' => $manualAck,
        'server_time' => date(DATE_ATOM),
    ]);
} catch (InvalidArgumentException $error) {
    JsonResponse::error(422, 'INVALID_DATA', $error->getMessage());
} catch (Throwable) {
    JsonResponse::error(500, 'INGEST_FAILED', 'Der Upload konnte nicht gespeichert werden.');
}
