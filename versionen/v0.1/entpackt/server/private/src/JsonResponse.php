<?php
declare(strict_types=1);

namespace GymProgressApi;

final class JsonResponse
{
    public static function securityHeaders(): void
    {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('Pragma: no-cache');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    }

    /** @param array<string,mixed> $payload */
    public static function send(int $status, array $payload): never
    {
        http_response_code($status);
        echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        exit;
    }

    public static function error(int $status, string $code, string $message): never
    {
        self::send($status, [
            'schema_version' => 1,
            'error' => ['code' => $code, 'message' => $message],
        ]);
    }
}
