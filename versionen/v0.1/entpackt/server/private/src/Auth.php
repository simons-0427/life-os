<?php
declare(strict_types=1);

namespace GymProgressApi;

use PDO;

final class AuthContext
{
    public function __construct(public readonly int $accountId, public readonly string $scope) {}
}

final class Auth
{
    public function __construct(private readonly PDO $pdo) {}

    public function requireScope(string $token, string $requiredScope): AuthContext
    {
        if (!preg_match('/^(gpr|gpw)_([A-Za-z0-9_-]{8,32})\.([A-Za-z0-9_-]{32,128})$/D', $token, $matches)) {
            JsonResponse::error(401, 'INVALID_API_KEY', 'Der API-Schlüssel ist ungültig.');
        }
        $keyId = $matches[1] . '_' . $matches[2];
        $statement = $this->pdo->prepare(
            'SELECT account_id, scope, secret_hash FROM gymprogress_api_keys '
            . 'WHERE key_id = :key_id AND enabled = 1 LIMIT 1'
        );
        $statement->execute(['key_id' => $keyId]);
        $row = $statement->fetch();
        $actualHash = hash('sha256', $token, true);
        if (!is_array($row) || !is_string($row['secret_hash'] ?? null) || !hash_equals($row['secret_hash'], $actualHash)) {
            JsonResponse::error(401, 'INVALID_API_KEY', 'Der API-Schlüssel ist ungültig.');
        }
        $scope = (string) $row['scope'];
        if ($scope !== $requiredScope && !($requiredScope === 'read' && $scope === 'write')) {
            JsonResponse::error(403, 'INSUFFICIENT_SCOPE', 'Dieser API-Schlüssel hat nicht die benötigte Berechtigung.');
        }
        return new AuthContext((int) $row['account_id'], $scope);
    }
}
