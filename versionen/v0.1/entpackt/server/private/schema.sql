CREATE TABLE IF NOT EXISTS gymprogress_accounts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    display_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gymprogress_api_keys (
    key_id VARCHAR(40) NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    scope ENUM('read', 'write') NOT NULL,
    secret_hash BINARY(32) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (key_id),
    CONSTRAINT fk_gymprogress_key_account FOREIGN KEY (account_id)
        REFERENCES gymprogress_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gymprogress_observations (
    account_id BIGINT UNSIGNED NOT NULL,
    observed_date DATE NOT NULL,
    namespace VARCHAR(64) NOT NULL,
    metric VARCHAR(64) NOT NULL,
    value_ciphertext MEDIUMBLOB NOT NULL,
    value_nonce BINARY(12) NOT NULL,
    value_tag BINARY(16) NOT NULL,
    source VARCHAR(64) NOT NULL,
    source_revision BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, observed_date, namespace, metric),
    KEY ix_gymprogress_observations_range (account_id, observed_date),
    CONSTRAINT fk_gymprogress_observation_account FOREIGN KEY (account_id)
        REFERENCES gymprogress_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gymprogress_manual_revisions (
    account_id BIGINT UNSIGNED NOT NULL,
    observed_date DATE NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, observed_date),
    CONSTRAINT fk_gymprogress_revision_account FOREIGN KEY (account_id)
        REFERENCES gymprogress_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
