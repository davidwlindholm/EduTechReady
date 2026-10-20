<?php
/**
 * EduTechReady API configuration.
 *
 * Copy this file to private/config.php and fill in real values.
 * private/config.php is never committed (see .gitignore).
 * public/api/lib.php loads it through LOUNGE_CONFIG_PATH.
 */

return [
    // Server: MySQL or MariaDB. Create the tables with db/schema.mysql.sql.
    'dsn' => 'mysql:host=localhost;dbname=lounge;charset=utf8mb4',
    'user' => 'lounge_user',
    'password' => 'change-me',

    // Local development: SQLite, tables created automatically from
    // db/schema.sqlite.sql on the first request. Use these instead:
    // 'dsn' => 'sqlite:' . dirname(__DIR__) . '/db/dev.sqlite',
    // 'user' => null,
    // 'password' => null,

    // false makes both endpoints answer 503 "closed".
    'api_enabled' => true,
    // Submissions older than this are deleted on the next submit.
    'retention_days' => 30,
    'max_submissions_per_session' => 200,
    // Larger request bodies get 413 "too_large".
    'max_body_bytes' => 16384,
];
