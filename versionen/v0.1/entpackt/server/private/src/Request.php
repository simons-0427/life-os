<?php
declare(strict_types=1);

namespace GymProgressApi;

final class Request
{
    public static function requireHttps(): void
    {
        $https = strtolower((string) ($_SERVER['HTTPS'] ?? ''));
        $port = (string) ($_SERVER['SERVER_PORT'] ?? '');
        if (!in_array($https, ['on', '1'], true) && $port !== '443') {
            JsonResponse::error(400, 'HTTPS_REQUIRED', 'Die API akzeptiert nur HTTPS.');
        }
    }

    public static function requireMethod(string $method): void
    {
        if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? '')) !== strtoupper($method)) {
            header('Allow: ' . strtoupper($method));
            JsonResponse::error(405, 'METHOD_NOT_ALLOWED', 'Diese HTTP-Methode ist nicht erlaubt.');
        }
    }

    /** @return array<string,mixed> */
    public static function jsonBody(int $maximumBytes = 1_500_000): array
    {
        $declared = filter_var($_SERVER['CONTENT_LENGTH'] ?? null, FILTER_VALIDATE_INT);
        if (is_int($declared) && $declared > $maximumBytes) {
            JsonResponse::error(413, 'PAYLOAD_TOO_LARGE', 'Der Upload ist zu groß.');
        }
        $stream = fopen('php://input', 'rb');
        if ($stream === false) {
            JsonResponse::error(400, 'READ_FAILED', 'Der Upload konnte nicht gelesen werden.');
        }
        $raw = stream_get_contents($stream, $maximumBytes + 1);
        if (!is_string($raw) || strlen($raw) > $maximumBytes) {
            JsonResponse::error(413, 'PAYLOAD_TOO_LARGE', 'Der Upload ist zu groß.');
        }
        try {
            $decoded = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            JsonResponse::error(400, 'INVALID_JSON', 'Der Upload ist kein gültiges JSON.');
        }
        if (!is_array($decoded) || array_is_list($decoded)) {
            JsonResponse::error(400, 'INVALID_JSON_OBJECT', 'Der Upload muss ein JSON-Objekt sein.');
        }
        return $decoded;
    }

    public static function apiKey(): string
    {
        $value = $_SERVER['HTTP_X_GYMPROGRESS_KEY'] ?? '';
        if (!is_string($value) || $value === '' || strlen($value) > 240 || preg_match('/\s/', $value)) {
            JsonResponse::error(401, 'MISSING_API_KEY', 'Der API-Schlüssel fehlt oder ist ungültig.');
        }
        return $value;
    }
}
