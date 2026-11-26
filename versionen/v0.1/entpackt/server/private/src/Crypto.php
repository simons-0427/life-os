<?php
declare(strict_types=1);

namespace GymProgressApi;

final class EncryptedValue
{
    public function __construct(
        public readonly string $ciphertext,
        public readonly string $nonce,
        public readonly string $tag,
    ) {}
}

final class Crypto
{
    private readonly string $key;

    public function __construct(string $base64Key)
    {
        $key = base64_decode($base64Key, true);
        if (!is_string($key) || strlen($key) !== 32) {
            throw new \RuntimeException('Der Server-Verschlüsselungsschlüssel muss genau 32 Byte enthalten.');
        }
        $this->key = $key;
    }

    public function encrypt(mixed $value): EncryptedValue
    {
        $plain = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $nonce = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($plain, 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
        if (!is_string($ciphertext) || strlen($tag) !== 16) {
            throw new \RuntimeException('Ein API-Wert konnte nicht verschlüsselt werden.');
        }
        return new EncryptedValue($ciphertext, $nonce, $tag);
    }

    public function decrypt(string $ciphertext, string $nonce, string $tag): mixed
    {
        $plain = openssl_decrypt($ciphertext, 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, $nonce, $tag);
        if (!is_string($plain)) {
            throw new \RuntimeException('Ein gespeicherter API-Wert konnte nicht entschlüsselt werden.');
        }
        return json_decode($plain, true, 32, JSON_THROW_ON_ERROR);
    }
}
