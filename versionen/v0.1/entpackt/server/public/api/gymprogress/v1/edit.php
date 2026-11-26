<?php
declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use GymProgressApi\JsonResponse;
use GymProgressApi\Request;
use GymProgressApi\Validation;

Request::requireMethod('POST');
$context = $auth->requireScope(Request::apiKey(), 'write');
try {
    $body = Request::jsonBody(32_000);
    $operation = $body['operation'] ?? null;
    if (!in_array($operation, ['save', 'delete'], true) || !array_key_exists('expected', $body)) {
        throw new InvalidArgumentException('Die Bearbeitungsdaten sind unvollständig.');
    }
    $expected = $body['expected'];
    if ($expected !== null && (!is_string($expected) || !preg_match('/^[a-f0-9]{64}$/D', $expected))) {
        throw new InvalidArgumentException('Ungültiger Bearbeitungsstand.');
    }
    $raw = $body['record'] ?? null;
    if (!is_array($raw)) {
        throw new InvalidArgumentException('Ein Datensatz fehlt.');
    }
    $raw['source'] = 'live-os';
    if ($operation === 'delete') {
        $raw['value'] = false;
    }
    $record = Validation::upload(['schema_version' => 1, 'records' => [$raw]])->records[0];
    if (!$repository->edit($context->accountId, $record, $expected, $operation === 'delete')) {
        JsonResponse::error(409, 'EDIT_CONFLICT', 'Der Wert hat sich geändert. Lade die Daten neu.');
    }
    JsonResponse::send(200, ['schema_version' => 1, 'saved' => true]);
} catch (InvalidArgumentException $error) {
    JsonResponse::error(422, 'INVALID_EDIT', $error->getMessage());
} catch (Throwable $error) {
    JsonResponse::error(500, 'EDIT_FAILED', 'Die Änderung konnte nicht gespeichert werden.');
}
