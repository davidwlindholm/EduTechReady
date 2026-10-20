<?php
/**
 * GET api/results.php?session=CODE: aggregated placements.
 *
 * Arrays are sorted ascending so their order reveals nothing about who
 * answered what. Only character ids in characters.json are reported.
 * Submissions older than retention_days are left out even before submit.php
 * deletes them (results never deletes anything). n and the arrays are read
 * in one query, so they always describe the same set of submissions.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

lounge_bootstrap();
lounge_require_method('GET');

$config = lounge_config();
lounge_require_enabled($config);

$session = $_GET['session'] ?? null;
if (!lounge_valid_session($session)) {
    lounge_error(400, 'invalid_session');
}

$characterIds = lounge_character_ids();
$characters = [];
foreach ($characterIds as $id) {
    $characters[$id] = ['samr' => [], 'rogers' => []];
}

$pdo = lounge_pdo($config);
$cutoff = lounge_utc_timestamp($config['retention_days']);

// One statement, so n and the value arrays come from the same snapshot:
// a submit that lands in between cannot make them
// disagree. The LEFT JOIN keeps every submission row in the result, so n
// counts submissions, not placements.
$rows = $pdo->prepare(
    'SELECT s.id AS submission_id, p.character_id, p.axis, p.value FROM submissions s'
    . ' LEFT JOIN placements p ON p.submission_id = s.id'
    . ' WHERE s.session_code = ? AND s.created_at >= ?'
);
$rows->execute([$session, $cutoff]);
$submissionIds = [];
foreach ($rows as $row) {
    $submissionIds[(int) $row['submission_id']] = true;
    if ($row['character_id'] === null) {
        continue; // a submission without placement rows still counts in n
    }
    $id = (string) $row['character_id'];
    $axis = (string) $row['axis'];
    if (isset($characters[$id][$axis])) {
        $characters[$id][$axis][] = (int) $row['value'];
    }
}
$n = count($submissionIds);
foreach ($characters as &$axes) {
    sort($axes['samr'], SORT_NUMERIC);
    sort($axes['rogers'], SORT_NUMERIC);
}
unset($axes);

lounge_respond(200, [
    'ok' => true,
    'session' => $session,
    'n' => $n,
    'characters' => (object) $characters,
]);
