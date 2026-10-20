<?php
/**
 * POST api/submit.php: stores one pair's placements.
 *
 * Order: method (405), api_enabled (503), body size (413), JSON and
 * validation (400), retention cleanup, duplicate (409), session cap (429),
 * insert (201). The cleanup and the insert each run in one transaction.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

lounge_bootstrap();
lounge_require_method('POST');

$config = lounge_config();
lounge_require_enabled($config);

$body = lounge_read_body($config['max_body_bytes']);
$submission = lounge_parse_submission($body, lounge_character_ids());

$pdo = lounge_pdo($config);

// Retention: delete expired submissions and their placements together.
$cutoff = lounge_utc_timestamp($config['retention_days']);
$pdo->beginTransaction();
$pdo->prepare('DELETE FROM placements WHERE submission_id IN (SELECT id FROM submissions WHERE created_at < ?)')
    ->execute([$cutoff]);
$pdo->prepare('DELETE FROM submissions WHERE created_at < ?')->execute([$cutoff]);
$pdo->commit();

$pdo->beginTransaction();
try {
    $existing = $pdo->prepare('SELECT 1 FROM submissions WHERE session_code = ? AND client_id = ?');
    $existing->execute([$submission['session'], $submission['clientId']]);
    if ($existing->fetchColumn() !== false) {
        $pdo->rollBack();
        lounge_error(409, 'already_submitted');
    }

    // The count and the insert share one transaction. Two simultaneous
    // submits on MySQL could still pass a full cap by one; acceptable here.
    $count = $pdo->prepare('SELECT COUNT(*) FROM submissions WHERE session_code = ?');
    $count->execute([$submission['session']]);
    if ((int) $count->fetchColumn() >= $config['max_submissions_per_session']) {
        $pdo->rollBack();
        lounge_error(429, 'session_full');
    }

    $insert = $pdo->prepare('INSERT INTO submissions (session_code, client_id, created_at) VALUES (?, ?, ?)');
    $insert->execute([$submission['session'], $submission['clientId'], lounge_utc_timestamp()]);
    $submissionId = (int) $pdo->lastInsertId();

    $placement = $pdo->prepare('INSERT INTO placements (submission_id, character_id, axis, value) VALUES (?, ?, ?, ?)');
    foreach ($submission['placements'] as $characterId => $values) {
        foreach (LOUNGE_AXES as $axis) {
            $placement->execute([$submissionId, $characterId, $axis, $values[$axis]]);
        }
    }
    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    // SQLSTATE 23000: the unique key caught a duplicate that raced the check above.
    if ($e->getCode() === '23000') {
        lounge_error(409, 'already_submitted');
    }
    throw $e;
}

lounge_respond(201, ['ok' => true]);
