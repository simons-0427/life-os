<?php
declare(strict_types=1);

namespace GymProgressApi;

use PDO;
use PDOException;

final class Database
{
    /** @param array<string,mixed> $config */
    public static function connect(array $config): PDO
    {
        try {
            return new PDO(
                (string) ($config['dsn'] ?? ''),
                (string) ($config['user'] ?? ''),
                (string) ($config['password'] ?? ''),
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false,
                    PDO::ATTR_STRINGIFY_FETCHES => false,
                ],
            );
        } catch (PDOException) {
            JsonResponse::error(503, 'DATABASE_UNAVAILABLE', 'Der Datenspeicher ist vorübergehend nicht erreichbar.');
        }
    }
}
