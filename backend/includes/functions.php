<?php
/**
 * Haversine distance between two GPS points, in meters.
 */
function gps_distance_meters(float $lat1, float $lng1, float $lat2, float $lng2): float {
    $earthRadius = 6371000; // meters
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) ** 2 +
         cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
         sin($dLng / 2) ** 2;
    $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
    return $earthRadius * $c;
}

/**
 * Find the nearest active geofence to a GPS point.
 * Returns ['geofence' => row|null, 'distance' => meters|null, 'within' => bool]
 */
function find_nearest_geofence(mysqli $conn, float $lat, float $lng): array {
    $result = $conn->query('SELECT * FROM geofences WHERE is_active = 1');
    $best = null;
    $bestDistance = null;
    while ($fence = $result->fetch_assoc()) {
        $d = gps_distance_meters($lat, $lng, (float)$fence['latitude'], (float)$fence['longitude']);
        if ($bestDistance === null || $d < $bestDistance) {
            $bestDistance = $d;
            $best = $fence;
        }
    }
    $within = $best !== null && $bestDistance <= (float)$best['radius_m'];
    return ['geofence' => $best, 'distance' => $bestDistance, 'within' => $within];
}

/**
 * Determine on_time / late based on shift_start + grace period.
 */
function compute_time_status(string $shiftStart, int $graceMinutes, DateTime $checkIn): string {
    $today = $checkIn->format('Y-m-d');
    $shiftDT = new DateTime($today . ' ' . $shiftStart);
    $shiftDT->modify("+{$graceMinutes} minutes");
    return $checkIn > $shiftDT ? 'late' : 'on_time';
}

/** Course attendance is on time while the attendance window is open. */
function compute_session_time_status(string $endsAt, int $unusedGraceMinutes, DateTime $checkIn): string {
    return $checkIn <= new DateTime($endsAt) ? 'on_time' : 'late';
}

function badge_class(string $status): string {
    return match ($status) {
        'on_time' => 'badge-green',
        'late' => 'badge-amber',
        'geofence_violation', 'face_mismatch' => 'badge-red',
        default => 'badge-gray',
    };
}

function badge_label(string $status): string {
    return match ($status) {
        'on_time' => 'ON TIME',
        'late' => 'LATE',
        'geofence_violation' => 'GEOFENCE VIOLATION',
        'face_mismatch' => 'FACE MISMATCH',
        default => strtoupper($status),
    };
}

/** Add status_label / badge_class fields onto an attendance_logs row for the JSON API. */
function attach_badge(array $log): array {
    $log['status_label'] = badge_label($log['status']);
    $log['badge_class'] = badge_class($log['status']);
    return $log;
}

/**
 * Euclidean distance between two face-api.js 128-point face descriptors.
 * Returns null if the vectors are missing/mismatched in length.
 */
function face_euclidean_distance(?array $a, ?array $b): ?float {
    if (!$a || !$b || count($a) !== count($b)) {
        return null;
    }
    $sumSq = 0.0;
    foreach ($a as $i => $v) {
        $diff = (float)$v - (float)$b[$i];
        $sumSq += $diff * $diff;
    }
    return sqrt($sumSq);
}

/**
 * Convert a face descriptor distance into a human-friendly match percentage.
 * face-api.js distances: ~0 = identical, ~0.6 = typical same-person threshold, 1.2+ = very different.
 */
function face_distance_to_percent(float $distance): float {
    $pct = (1 - min($distance, 1.2) / 1.2) * 100;
    return round(max(0, $pct), 1);
}
