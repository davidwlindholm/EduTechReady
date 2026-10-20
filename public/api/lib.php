<?php
/**
 * Shared helpers for the EduTechReady API (submit.php and results.php).
 *
 * Responsibilities: config loading, PDO setup, the response headers every
 * response carries, the request body size limit, input validation and
 * error logging. Details of failures go to error_log() only; clients get a
 * short error code.
 *
 * Written for PHP 8.3 (the server's version). Do not use 8.4+ features.
 */

declare(strict_types=1);

/**
 * The one place the config path is defined. This is the
 * development layout (public/ next to private/). scripts/package.sh rewrites
 * it, and LOUNGE_SQLITE_SCHEMA_PATH, to __DIR__ . '/../private/config.php'
 * for the upload package, where private/ sits inside the game folder; see
 * docs/DEPLOY.md.
 */
const LOUNGE_CONFIG_PATH = __DIR__ . '/../../private/config.php';

/** Character ids are read from here on every request. */
const LOUNGE_CHARACTERS_PATH = __DIR__ . '/../content/characters.json';

/** Applied automatically to a fresh SQLite database (local development only). */
const LOUNGE_SQLITE_SCHEMA_PATH = __DIR__ . '/../../db/schema.sqlite.sql';

const LOUNGE_SESSION_PATTERN = '/^[A-HJ-NP-Z2-9]{6}\z/';
const LOUNGE_CLIENT_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/';
const LOUNGE_CHARACTER_ID_PATTERN = '/^[a-z][a-z0-9-]{0,39}\z/';
const LOUNGE_AXES = ['samr', 'rogers'];
const LOUNGE_VALUE_MIN = 0;
const LOUNGE_VALUE_MAX = 100;
const LOUNGE_JSON_DEPTH = 8;

/** Thrown for any request the client got wrong; carries the HTTP status and error code. */
final class LoungeRequestError extends RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $errorCode)
    {
        parent::__construct($errorCode);
    }
}

// lib.php is only included, never requested on its own.
if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

/**
 * Sets up error handling so nothing leaks to the client: PHP notices become
 * exceptions, uncaught exceptions and fatal errors become a 500 "server" response.
 */
function lounge_bootstrap(): void
{
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
    error_reporting(E_ALL);

    set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
        if ((error_reporting() & $severity) === 0) {
            return false;
        }
        throw new ErrorException($message, 0, $severity, $file, $line);
    });

    set_exception_handler(static function (Throwable $e): void {
        if ($e instanceof LoungeRequestError) {
            lounge_error($e->status, $e->errorCode);
        }
        lounge_log('uncaught ' . get_class($e) . ': ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine());
        lounge_error(500, 'server');
    });

    register_shutdown_function(static function (): void {
        $last = error_get_last();
        $fatal = E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR | E_USER_ERROR;
        if ($last !== null && ($last['type'] & $fatal) !== 0) {
            lounge_log('fatal: ' . $last['message'] . ' at ' . $last['file'] . ':' . $last['line']);
            if (!headers_sent()) {
                lounge_send(500, ['ok' => false, 'error' => 'server']);
            }
        }
    });
}

/** Writes one line to the server log. Never echoed to the client. */
function lounge_log(string $message): void
{
    error_log('[lounge-api] ' . $message);
}

/** Sends a JSON response with the shared API headers (no-store, nosniff). Does not exit. */
function lounge_send(int $status, array $body, array $extraHeaders = []): void
{
    $json = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    if (!headers_sent()) {
        header_remove('X-Powered-By');
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        foreach ($extraHeaders as $line) {
            header($line);
        }
    }
    echo $json;
}

/** Sends a JSON response and ends the request. */
function lounge_respond(int $status, array $body, array $extraHeaders = []): never
{
    lounge_send($status, $body, $extraHeaders);
    exit;
}

/** Sends {"ok": false, "error": code} and ends the request. */
function lounge_error(int $status, string $code, array $extraHeaders = []): never
{
    lounge_respond($status, ['ok' => false, 'error' => $code], $extraHeaders);
}

/** Ends with 405 unless the request uses $method. */
function lounge_require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        lounge_error(405, 'method', ['Allow: ' . $method]);
    }
}

/**
 * Loads and checks private/config.php. A missing or malformed config is a
 * server error (logged), never shown to the client.
 *
 * @return array{dsn: string, user: ?string, password: ?string, api_enabled: bool,
 *               retention_days: int, max_submissions_per_session: int, max_body_bytes: int}
 */
function lounge_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }
    if (!is_file(LOUNGE_CONFIG_PATH)) {
        throw new RuntimeException('config file not found: ' . LOUNGE_CONFIG_PATH);
    }
    // Output from config.php (a UTF-8 BOM or whitespace around the PHP tags,
    // easy to add when editing on a host) would send headers early and break
    // every response. Buffer it, drop it, and log it.
    ob_start();
    try {
        $loaded = require LOUNGE_CONFIG_PATH;
    } finally {
        $stray = ob_get_clean();
    }
    if (is_string($stray) && $stray !== '') {
        lounge_log('config.php produced ' . strlen($stray) . ' bytes of output (a BOM or text outside <?php?); ignored');
    }
    if (!is_array($loaded)) {
        throw new RuntimeException('config file does not return an array');
    }
    $checks = [
        'dsn' => static fn ($v): bool => is_string($v) && $v !== '',
        'api_enabled' => static fn ($v): bool => is_bool($v),
        'retention_days' => static fn ($v): bool => is_int($v) && $v >= 1,
        'max_submissions_per_session' => static fn ($v): bool => is_int($v) && $v >= 1,
        'max_body_bytes' => static fn ($v): bool => is_int($v) && $v >= 256,
    ];
    foreach ($checks as $key => $valid) {
        if (!array_key_exists($key, $loaded) || !$valid($loaded[$key])) {
            throw new RuntimeException('config key missing or invalid: ' . $key);
        }
    }
    foreach (['user', 'password'] as $key) {
        $value = $loaded[$key] ?? null;
        if ($value !== null && !is_string($value)) {
            throw new RuntimeException('config key invalid: ' . $key);
        }
        $loaded[$key] = $value;
    }
    $config = $loaded;
    return $config;
}

/** Ends with 503 "closed" when api_enabled is false. */
function lounge_require_enabled(array $config): void
{
    if ($config['api_enabled'] !== true) {
        lounge_error(503, 'closed');
    }
}

/** Opens the database with exceptions on and real prepared statements. */
function lounge_pdo(array $config): PDO
{
    $pdo = new PDO($config['dsn'], $config['user'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 5,
    ]);
    if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
        lounge_ensure_sqlite_schema($pdo);
    }
    return $pdo;
}

/**
 * Local development only: creates the tables in a fresh SQLite file from
 * db/schema.sqlite.sql. The server uses MySQL, where this never runs.
 */
function lounge_ensure_sqlite_schema(PDO $pdo): void
{
    $exists = $pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'submissions'")->fetchColumn();
    if ($exists !== false) {
        return;
    }
    $schema = file_get_contents(LOUNGE_SQLITE_SCHEMA_PATH);
    if ($schema === false) {
        throw new RuntimeException('cannot read ' . LOUNGE_SQLITE_SCHEMA_PATH);
    }
    $pdo->exec($schema);
}

/**
 * Valid character ids from characters.json, read on every request.
 *
 * @return list<string>
 */
function lounge_character_ids(): array
{
    $raw = file_get_contents(LOUNGE_CHARACTERS_PATH);
    if ($raw === false) {
        throw new RuntimeException('cannot read ' . LOUNGE_CHARACTERS_PATH);
    }
    $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($data) || !isset($data['characters']) || !is_array($data['characters'])) {
        throw new RuntimeException('characters.json has no characters array');
    }
    $ids = [];
    foreach ($data['characters'] as $character) {
        $id = is_array($character) ? ($character['id'] ?? null) : null;
        if (!is_string($id) || preg_match(LOUNGE_CHARACTER_ID_PATTERN, $id) !== 1 || in_array($id, $ids, true)) {
            throw new RuntimeException('characters.json has a missing, invalid or duplicate id');
        }
        $ids[] = $id;
    }
    if ($ids === []) {
        throw new RuntimeException('characters.json lists no characters');
    }
    return $ids;
}

/**
 * Reads the request body, at most max_body_bytes. Reads one byte past the
 * limit from php://input, so a body without (or with a wrong) Content-Length
 * is still caught. Ends with 413 "too_large" when the body is over the limit.
 */
function lounge_read_body(int $maxBytes): string
{
    $declared = $_SERVER['CONTENT_LENGTH'] ?? '';
    if (is_string($declared) && ctype_digit($declared) && (int) $declared > $maxBytes) {
        lounge_error(413, 'too_large');
    }
    $stream = fopen('php://input', 'rb');
    if ($stream === false) {
        throw new RuntimeException('cannot open php://input');
    }
    $body = stream_get_contents($stream, $maxBytes + 1);
    fclose($stream);
    if ($body === false) {
        throw new RuntimeException('cannot read php://input');
    }
    if (strlen($body) > $maxBytes) {
        lounge_error(413, 'too_large');
    }
    return $body;
}

/** True if $value is a session code: six characters from A-Z and 2-9 without I, O, 0 and 1 (no uppercasing here). */
function lounge_valid_session(mixed $value): bool
{
    return is_string($value) && preg_match(LOUNGE_SESSION_PATTERN, $value) === 1;
}

/** True if $value is a lowercase UUID v4. */
function lounge_valid_client(mixed $value): bool
{
    return is_string($value) && preg_match(LOUNGE_CLIENT_PATTERN, $value) === 1;
}

/**
 * Decodes and validates a submit body. JSON objects decode to
 * stdClass so {} and [] stay distinguishable. Unknown top-level keys are
 * ignored; everything inside "placements" is strict.
 *
 * Error precedence: bad_json, invalid_session, invalid_client, then for
 * placements: invalid_placements (not an object), unknown_character,
 * invalid_placements (a value), incomplete.
 *
 * A value must be a JSON integer: 42.0, 4.2e1, "42", true and null are
 * rejected, because json_decode gives a float, string, bool or null for them.
 *
 * @param list<string> $characterIds
 * @return array{session: string, clientId: string, placements: array<string, array{samr: int, rogers: int}>}
 */
function lounge_parse_submission(string $body, array $characterIds): array
{
    try {
        $data = json_decode($body, false, LOUNGE_JSON_DEPTH, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new LoungeRequestError(400, 'bad_json');
    }
    if (!$data instanceof stdClass) {
        throw new LoungeRequestError(400, 'bad_json');
    }

    $session = $data->session ?? null;
    if (!lounge_valid_session($session)) {
        throw new LoungeRequestError(400, 'invalid_session');
    }
    $clientId = $data->clientId ?? null;
    if (!lounge_valid_client($clientId)) {
        throw new LoungeRequestError(400, 'invalid_client');
    }

    $placements = $data->placements ?? null;
    if (!$placements instanceof stdClass) {
        throw new LoungeRequestError(400, 'invalid_placements');
    }
    $entries = get_object_vars($placements);
    foreach (array_keys($entries) as $id) {
        if (!in_array((string) $id, $characterIds, true)) {
            throw new LoungeRequestError(400, 'unknown_character');
        }
    }

    $clean = [];
    foreach ($entries as $id => $entry) {
        if (!$entry instanceof stdClass) {
            throw new LoungeRequestError(400, 'invalid_placements');
        }
        $values = get_object_vars($entry);
        if (count($values) !== count(LOUNGE_AXES)) {
            throw new LoungeRequestError(400, 'invalid_placements');
        }
        $row = [];
        foreach (LOUNGE_AXES as $axis) {
            $value = $values[$axis] ?? null;
            if (!is_int($value) || $value < LOUNGE_VALUE_MIN || $value > LOUNGE_VALUE_MAX) {
                throw new LoungeRequestError(400, 'invalid_placements');
            }
            $row[$axis] = $value;
        }
        $clean[(string) $id] = $row;
    }

    foreach ($characterIds as $id) {
        if (!isset($clean[$id])) {
            throw new LoungeRequestError(400, 'incomplete');
        }
    }

    return ['session' => $session, 'clientId' => $clientId, 'placements' => $clean];
}

/** UTC timestamp in the stored format, optionally $days in the past. */
function lounge_utc_timestamp(int $daysAgo = 0): string
{
    return gmdate('Y-m-d H:i:s', time() - $daysAgo * 86400);
}
