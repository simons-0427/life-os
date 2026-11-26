<?php
declare(strict_types=1);

namespace GymProgressApi;

final class UploadBatch
{
    /**
     * @param list<array{date:string,namespace:string,metric:string,value:mixed,source:string,revision:?int}> $records
     * @param list<array{date:string,revision:int,records:list<array{date:string,namespace:string,metric:string,value:mixed,source:string,revision:?int}>}> $manualDays
     */
    public function __construct(public readonly array $records, public readonly array $manualDays) {}
}

final class Validation
{
    private const HEALTH_METRICS = [
        'steps', 'weight_kg', 'nutrition_kcal', 'sleep_duration_minutes',
        'deep_sleep_minutes', 'deep_sleep_phases', 'light_sleep_minutes',
        'light_sleep_phases', 'rem_sleep_minutes', 'rem_sleep_phases',
        'awake_minutes', 'awake_phases', 'resting_heart_rate_bpm', 'sleep_heart_rate_bpm',
    ];
    private const MANUAL_METRICS = [
        'cycling_km', 'training', 'target_phase', 'current_phase', 'sleep_score', 'notes',
    ];

    /** @param array<string,mixed> $payload */
    public static function upload(array $payload): UploadBatch
    {
        if (($payload['schema_version'] ?? null) === 4 && ($payload['source'] ?? null) === 'android-health-connect') {
            return self::androidHealth($payload);
        }
        if (($payload['schema_version'] ?? null) === 1 && isset($payload['records'])) {
            return self::genericRecords($payload);
        }
        throw new \InvalidArgumentException('Unbekanntes Upload-Schema.');
    }

    /** @param array<string,mixed> $payload */
    private static function androidHealth(array $payload): UploadBatch
    {
        if (($payload['timezone'] ?? null) !== 'Europe/Berlin' || !is_array($payload['days'] ?? null)) {
            throw new \InvalidArgumentException('Der Health-Connect-Upload ist unvollständig.');
        }
        $records = [];
        foreach ($payload['days'] as $day) {
            if (!is_array($day) || array_is_list($day)) {
                throw new \InvalidArgumentException('Ein Health-Tag ist ungültig.');
            }
            $date = self::date($day['date'] ?? null);
            foreach (self::HEALTH_METRICS as $metric) {
                if (array_key_exists($metric, $day)) {
                    $records[] = self::record($date, 'fitness.health', $metric, $day[$metric], 'android-health-connect', null);
                }
            }
        }
        $manualDays = [];
        $manualRaw = $payload['manual_entries'] ?? [];
        if (!is_array($manualRaw)) {
            throw new \InvalidArgumentException('Die manuellen Werte sind ungültig.');
        }
        foreach ($manualRaw as $entry) {
            if (!is_array($entry) || array_is_list($entry) || !is_array($entry['values'] ?? null)) {
                throw new \InvalidArgumentException('Ein manueller Tag ist ungültig.');
            }
            $date = self::date($entry['date'] ?? null);
            $revision = filter_var($entry['revision'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($revision)) {
                throw new \InvalidArgumentException('Eine manuelle Revision ist ungültig.');
            }
            $dayRecords = [];
            foreach ($entry['values'] as $metric => $value) {
                if (!is_string($metric) || !in_array($metric, self::MANUAL_METRICS, true)) {
                    throw new \InvalidArgumentException('Eine manuelle Metrik ist unbekannt.');
                }
                $dayRecords[] = self::record($date, 'fitness.manual', $metric, $value, 'android-manual', $revision);
            }
            $manualDays[] = ['date' => $date, 'revision' => $revision, 'records' => $dayRecords];
        }
        self::limit(count($records) + array_sum(array_map(static fn(array $item): int => count($item['records']), $manualDays)));
        return new UploadBatch($records, $manualDays);
    }

    /** @param array<string,mixed> $payload */
    private static function genericRecords(array $payload): UploadBatch
    {
        if (!is_array($payload['records'])) {
            throw new \InvalidArgumentException('Die Datensatzliste ist ungültig.');
        }
        self::limit(count($payload['records']));
        $records = [];
        foreach ($payload['records'] as $raw) {
            if (!is_array($raw) || array_is_list($raw)) {
                throw new \InvalidArgumentException('Ein Datensatz ist ungültig.');
            }
            $date = self::date($raw['date'] ?? null);
            $namespace = $raw['namespace'] ?? null;
            $metric = $raw['metric'] ?? null;
            $source = $raw['source'] ?? 'api-client';
            if (!is_string($namespace) || !preg_match('/^[a-z0-9]+(?:[._][a-z0-9]+)*$/D', $namespace)) {
                throw new \InvalidArgumentException('Ein Namespace ist ungültig.');
            }
            if (!is_string($metric) || !preg_match('/^[a-z0-9]+(?:_[a-z0-9]+)*$/D', $metric)) {
                throw new \InvalidArgumentException('Ein Metrikname ist ungültig.');
            }
            if (!is_string($source) || !preg_match('/^[a-z0-9][a-z0-9._-]{0,63}$/D', $source)) {
                throw new \InvalidArgumentException('Eine Quelle ist ungültig.');
            }
            $records[] = self::record($date, $namespace, $metric, $raw['value'] ?? null, $source, null);
        }
        return new UploadBatch($records, []);
    }

    /** @return array{date:string,namespace:string,metric:string,value:mixed,source:string,revision:?int} */
    private static function record(string $date, string $namespace, string $metric, mixed $value, string $source, ?int $revision): array
    {
        if ($value === null || is_array($value) || is_object($value) || (is_float($value) && !is_finite($value))) {
            throw new \InvalidArgumentException('Ein Wert hat einen nicht unterstützten Datentyp.');
        }
        if (is_string($value) && (strlen($value) > 8000 || preg_match('//u', $value) !== 1)) {
            throw new \InvalidArgumentException('Ein Textwert ist zu lang oder ungültig.');
        }
        return compact('date', 'namespace', 'metric', 'value', 'source', 'revision');
    }

    private static function date(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
            throw new \InvalidArgumentException('Ein Datum ist ungültig.');
        }
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($parsed === false || $parsed->format('Y-m-d') !== $value || $value < '2010-01-01' || $value > date('Y-m-d', strtotime('+2 days'))) {
            throw new \InvalidArgumentException('Ein Datum liegt außerhalb des gültigen Bereichs.');
        }
        return $value;
    }

    private static function limit(int $count): void
    {
        if ($count < 1 || $count > 5000) {
            throw new \InvalidArgumentException('Ein Upload muss 1 bis 5000 Werte enthalten.');
        }
    }

    /** @return array{0:string,1:string} */
    public static function dateRange(mixed $from, mixed $to): array
    {
        $start = self::date($from);
        $end = self::date($to);
        if ($start > $end) {
            throw new \InvalidArgumentException('Das Startdatum liegt nach dem Enddatum.');
        }
        $days = (new \DateTimeImmutable($start))->diff(new \DateTimeImmutable($end))->days;
        if (!is_int($days) || $days > 366) {
            throw new \InvalidArgumentException('Ein Abruf darf höchstens 367 Tage umfassen.');
        }
        return [$start, $end];
    }
}
