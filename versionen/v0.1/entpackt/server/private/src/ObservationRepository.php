<?php
declare(strict_types=1);

namespace GymProgressApi;

use PDO;

require_once __DIR__ . '/DailyCalculations.php';

final class ObservationRepository
{
    public const OVERRIDE_SOURCE = 'live-os-override';
    public const DELETED_SOURCE = 'live-os-deleted';

    public function __construct(private readonly PDO $pdo, private readonly Crypto $crypto) {}

    /**
     * @param list<array{date:string,namespace:string,metric:string,value:mixed,source:string,revision:?int}> $records
     * @param list<array{date:string,revision:int,records:list<array{date:string,namespace:string,metric:string,value:mixed,source:string,revision:?int}>}> $manualDays
     * @return list<string>
     */
    public function ingest(int $accountId, array $records, array $manualDays): array
    {
        $this->pdo->beginTransaction();
        try {
            $this->lockAccount($accountId);
            $refresh = false;
            foreach ($records as $record) {
                if (DailyCalculations::owns($record) ||
                    in_array($record['source'], [DailyCalculations::SOURCE, DailyCalculations::HISTORICAL_SOURCE], true)) {
                    throw new \InvalidArgumentException('Dieser Messwert wird von der API berechnet.');
                }
                $this->upsert($accountId, $record);
                $refresh = $refresh || DailyCalculations::uses($record);
            }
            $acknowledgements = [];
            foreach ($manualDays as $manual) {
                $current = $this->manualRevision($accountId, $manual['date']);
                if ($current === null || $manual['revision'] > $current) {
                    foreach ($manual['records'] as $record) {
                        $this->upsert($accountId, $record);
                    }
                    $revision = $this->pdo->prepare(
                        'INSERT INTO gymprogress_manual_revisions (account_id, observed_date, revision) '
                        . 'VALUES (:account_id, :observed_date, :revision) '
                        . 'ON DUPLICATE KEY UPDATE revision = VALUES(revision), updated_at = CURRENT_TIMESTAMP'
                    );
                    $revision->execute([
                        'account_id' => $accountId,
                        'observed_date' => $manual['date'],
                        'revision' => $manual['revision'],
                    ]);
                }
                $acknowledgements[] = $manual['date'] . ':' . $manual['revision'];
            }
            if ($refresh) {
                $this->refreshDailyCalculations($accountId);
            }
            $this->pdo->commit();
            return $acknowledgements;
        } catch (\Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    private function lockAccount(int $accountId): void
    {
        $statement = $this->pdo->prepare('SELECT id FROM gymprogress_accounts WHERE id = ? FOR UPDATE');
        $statement->execute([$accountId]);
        $statement->closeCursor();
    }

    private function refreshDailyCalculations(int $accountId): void
    {
        $health = implode(',', array_fill(0, count(DailyCalculations::HEALTH), '?'));
        $gym = [...DailyCalculations::GOALS, ...DailyCalculations::RESULTS];
        $metrics = implode(',', array_fill(0, count($gym), '?'));
        $statement = $this->pdo->prepare(
            'SELECT observed_date, metric, source, value_ciphertext, value_nonce, value_tag '
            . 'FROM gymprogress_observations WHERE account_id = ? AND source <> ? AND '
            . "((namespace = 'fitness.health' AND metric IN ($health)) "
            . "OR (namespace = 'fitness.gymprogress' AND metric IN ($metrics)))"
        );
        $statement->execute([$accountId, self::DELETED_SOURCE, ...DailyCalculations::HEALTH, ...$gym]);
        $days = $stored = [];
        while ($row = $statement->fetch()) {
            $date = $row['observed_date'];
            $metric = $row['metric'];
            $value = $this->crypto->decrypt($row['value_ciphertext'], $row['value_nonce'], $row['value_tag']);
            if (in_array($metric, DailyCalculations::RESULTS, true)) {
                $stored[$date][$metric] = ['value' => $value, 'source' => $row['source']];
            } else {
                $days[$date][$metric] = $value;
            }
        }

        $calculated = DailyCalculations::series($days);
        foreach ($calculated as $date => $values) {
            foreach ($values as $metric => $value) {
                $previous = $stored[$date][$metric] ?? [];
                if (($previous['source'] ?? null) !== DailyCalculations::SOURCE ||
                    (float) $previous['value'] !== (float) $value) {
                    $this->upsert($accountId, ['date' => $date, 'namespace' => 'fitness.gymprogress',
                        'metric' => $metric, 'value' => $value, 'source' => DailyCalculations::SOURCE, 'revision' => null]);
                }
                unset($stored[$date][$metric]);
            }
        }
        $delete = $this->pdo->prepare('DELETE FROM gymprogress_observations WHERE account_id = ? AND observed_date = ? '
            . "AND namespace = 'fitness.gymprogress' AND metric = ? AND source IN (?, ?)");
        foreach ($stored as $date => $values) {
            foreach ($values as $metric => $_) {
                $delete->execute([$accountId, $date, $metric, DailyCalculations::SOURCE, DailyCalculations::HISTORICAL_SOURCE]);
            }
        }
    }

    private function manualRevision(int $accountId, string $date): ?int
    {
        $statement = $this->pdo->prepare(
            'SELECT revision FROM gymprogress_manual_revisions '
            . 'WHERE account_id = :account_id AND observed_date = :observed_date FOR UPDATE'
        );
        $statement->execute(['account_id' => $accountId, 'observed_date' => $date]);
        $value = $statement->fetchColumn();
        return $value === false ? null : (int) $value;
    }

    /** @param array{date:string,namespace:string,metric:string,value:mixed,source:string,revision:?int} $record */
    private function upsert(int $accountId, array $record): void
    {
        if (in_array($record['source'], [self::OVERRIDE_SOURCE, self::DELETED_SOURCE], true)) {
            throw new \InvalidArgumentException('Diese Quellenbezeichnung ist für den API-Editor reserviert.');
        }
        $encrypted = $this->crypto->encrypt($record['value']);
        $statement = $this->pdo->prepare(
            'INSERT INTO gymprogress_observations '
            . '(account_id, observed_date, namespace, metric, value_ciphertext, value_nonce, value_tag, source, source_revision) '
            . 'VALUES (:account_id, :observed_date, :namespace, :metric, :ciphertext, :nonce, :tag, :source, :revision) '
            . "ON DUPLICATE KEY UPDATE "
            . "value_ciphertext = IF(source IN ('live-os-override','live-os-deleted','live-os'), value_ciphertext, VALUES(value_ciphertext)), "
            . "value_nonce = IF(source IN ('live-os-override','live-os-deleted','live-os'), value_nonce, VALUES(value_nonce)), "
            . "value_tag = IF(source IN ('live-os-override','live-os-deleted','live-os'), value_tag, VALUES(value_tag)), "
            . "source_revision = IF(source IN ('live-os-override','live-os-deleted','live-os'), source_revision, VALUES(source_revision)), "
            . "updated_at = IF(source IN ('live-os-override','live-os-deleted','live-os'), updated_at, CURRENT_TIMESTAMP), "
            . "source = IF(source IN ('live-os-override','live-os-deleted','live-os'), source, VALUES(source))"
        );
        $statement->bindValue(':account_id', $accountId, PDO::PARAM_INT);
        $statement->bindValue(':observed_date', $record['date']);
        $statement->bindValue(':namespace', $record['namespace']);
        $statement->bindValue(':metric', $record['metric']);
        $statement->bindValue(':ciphertext', $encrypted->ciphertext, PDO::PARAM_LOB);
        $statement->bindValue(':nonce', $encrypted->nonce, PDO::PARAM_LOB);
        $statement->bindValue(':tag', $encrypted->tag, PDO::PARAM_LOB);
        $statement->bindValue(':source', $record['source']);
        $statement->bindValue(':revision', $record['revision'], $record['revision'] === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $statement->execute();
    }

    /** @param array{date:string,namespace:string,metric:string,value:mixed} $record */
    public function edit(int $accountId, array $record, ?string $expected, bool $delete): bool
    {
        if (DailyCalculations::owns($record)) {
            throw new \InvalidArgumentException('Dieser Messwert wird von der API berechnet.');
        }
        $key = ['account' => $accountId, 'day' => $record['date'],
            'namespace' => $record['namespace'], 'metric' => $record['metric']];
        $where = 'account_id = :account AND observed_date = :day AND namespace = :namespace AND metric = :metric';
        $this->pdo->beginTransaction();
        try {
            $this->lockAccount($accountId);
            $read = $this->pdo->prepare(
                'SELECT source, value_nonce, value_tag FROM gymprogress_observations WHERE ' . $where . ' FOR UPDATE'
            );
            $read->execute($key);
            $old = $read->fetch();
            $visible = is_array($old) && $old['source'] !== self::DELETED_SOURCE;
            if (($delete && !$visible) || ($visible ? self::version($old) !== $expected : $expected !== null)) {
                $this->pdo->rollBack();
                return false;
            }
            if ($delete) {
                $update = $this->pdo->prepare(
                    'UPDATE gymprogress_observations SET source = :source, updated_at = CURRENT_TIMESTAMP WHERE ' . $where
                );
                $update->execute($key + ['source' => self::DELETED_SOURCE]);
            } else {
                $encrypted = $this->crypto->encrypt($record['value']);
                if (is_array($old)) {
                    $sql = 'UPDATE gymprogress_observations SET value_ciphertext = :ciphertext, value_nonce = :nonce, '
                         . 'value_tag = :tag, source = :source, source_revision = NULL, updated_at = CURRENT_TIMESTAMP WHERE ' . $where;
                } else {
                    $sql = 'INSERT INTO gymprogress_observations '
                         . '(account_id, observed_date, namespace, metric, value_ciphertext, value_nonce, value_tag, source) '
                         . 'VALUES (:account, :day, :namespace, :metric, :ciphertext, :nonce, :tag, :source)';
                }
                $update = $this->pdo->prepare($sql);
                $update->execute($key + ['ciphertext' => $encrypted->ciphertext, 'nonce' => $encrypted->nonce,
                    'tag' => $encrypted->tag, 'source' => self::OVERRIDE_SOURCE]);
            }
            if (DailyCalculations::uses($record)) {
                $this->refreshDailyCalculations($accountId);
            }
            $this->pdo->commit();
            return true;
        } catch (\Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if ($error instanceof \PDOException && in_array((int) ($error->errorInfo[1] ?? 0), [1062, 1205, 1213], true)) {
                return false;
            }
            throw $error;
        }
    }

    private static function version(array $row): string
    {
        return hash('sha256', $row['value_nonce'] . $row['value_tag']);
    }

    /** @return list<array{date:string,namespace:string,metric:string,value:mixed,source:string,updated_at:string,version:string}> */
    public function fetch(int $accountId, string $from, string $to): array
    {
        $statement = $this->pdo->prepare(
            'SELECT observed_date, namespace, metric, value_ciphertext, value_nonce, value_tag, source, updated_at '
            . 'FROM gymprogress_observations WHERE account_id = :account_id '
            . "AND observed_date BETWEEN :from_date AND :to_date AND source <> 'live-os-deleted' "
            . 'ORDER BY observed_date, namespace, metric'
        );
        $statement->execute(['account_id' => $accountId, 'from_date' => $from, 'to_date' => $to]);
        $records = [];
        while ($row = $statement->fetch()) {
            $records[] = [
                'date' => (string) $row['observed_date'],
                'namespace' => (string) $row['namespace'],
                'metric' => (string) $row['metric'],
                'value' => $this->crypto->decrypt((string) $row['value_ciphertext'], (string) $row['value_nonce'], (string) $row['value_tag']),
                'source' => (string) $row['source'],
                'updated_at' => (string) $row['updated_at'],
                'version' => self::version($row),
            ];
        }
        return $records;
    }
}
