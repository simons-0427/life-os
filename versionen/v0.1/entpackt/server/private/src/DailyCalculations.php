<?php
declare(strict_types=1);

namespace GymProgressApi;

final class DailyCalculations
{
    public const SOURCE = 'gymprogress-derived';
    public const HISTORICAL_SOURCE = 'gymprogress-history-derived';
    public const HEALTH = ['weight_kg', 'nutrition_kcal', 'deep_sleep_minutes', 'light_sleep_minutes',
        'rem_sleep_minutes', 'awake_minutes'];
    public const GOALS = ['zielgewicht', 'zielgewicht_min', 'zielgewicht_max', 'zielkalorien'];
    public const RESULTS = ['weight_deviation', 'calorie_deviation', 'stage_efficiency'];

    public static function uses(array $record): bool
    {
        return match ($record['namespace']) {
            'fitness.health' => in_array($record['metric'], self::HEALTH, true),
            'fitness.gymprogress' => in_array($record['metric'], self::GOALS, true),
            default => false,
        };
    }

    public static function owns(array $record): bool
    {
        return $record['namespace'] === 'fitness.gymprogress' && in_array($record['metric'], self::RESULTS, true);
    }

    /** @param array<string,array<string,mixed>> $days */
    public static function series(array $days): array
    {
        ksort($days, SORT_STRING);
        $goal = $calories = null;
        $result = [];
        foreach ($days as $date => $day) {
            $goal = self::weightGoal($day) ?? $goal;
            $target = $day['zielkalorien'] ?? null;
            if (self::number($target) && $target > 0) {
                $calories = $target;
            }
            $weight = $day['weight_kg'] ?? null;
            if (self::number($weight) && $goal !== null) {
                [$low, $high] = $goal;
                $gap = $weight < $low ? $weight - $low : ($weight > $high ? $weight - $high : 0);
                $result[$date]['weight_deviation'] = round($gap, 8);
            }
            $intake = $day['nutrition_kcal'] ?? null;
            if (self::number($intake) && $calories !== null) {
                $result[$date]['calorie_deviation'] = round($intake - $calories, 8);
            }
            $stages = array_map(static fn(string $metric) => $day[$metric] ?? null,
                ['deep_sleep_minutes', 'light_sleep_minutes', 'rem_sleep_minutes', 'awake_minutes']);
            if (count(array_filter($stages, static fn($v) => self::number($v) && $v >= 0)) === 4) {
                [$deep, $light, $rem, $awake] = $stages;
                $asleep = $deep + $light + $rem;
                if ($asleep > 0) {
                    $result[$date]['stage_efficiency'] = round(100 * ($asleep / ($asleep + $awake)), 8);
                }
            }
        }
        return $result;
    }

    private static function weightGoal(array $day): ?array
    {
        $target = $day['zielgewicht'] ?? null;
        if ((self::number($target) || is_string($target)) &&
            preg_match('/^(\d+(?:[.,]\d+)?)(?:\s*(?:[-–—]|bis)\s*(\d+(?:[.,]\d+)?))?\s*(?:kg)?$/iu', trim((string) $target), $parts)) {
            $low = (float) str_replace(',', '.', $parts[1]);
            $high = (float) str_replace(',', '.', $parts[2] ?? $parts[1]);
            if (self::number($low) && self::number($high) && $low > 0 && $high >= $low) {
                return [$low, $high];
            }
        }
        $low = $day['zielgewicht_min'] ?? null;
        $high = $day['zielgewicht_max'] ?? null;
        return self::number($low) && self::number($high) && $low > 0 && $high >= $low ? [$low, $high] : null;
    }

    private static function number(mixed $value): bool
    {
        return (is_int($value) || is_float($value)) && is_finite($value);
    }
}
