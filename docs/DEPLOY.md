# Deploying EduTechReady

How to put the game on a web host and check that it works. Written for a typical shared host: PHP 8.3 or newer, MySQL, Apache, HTTPS, and possibly no space outside the web root. The examples use the address <https://example.org/edutechready/>; replace it with your own.

The whole deployment is an upload. There is no build step on the server and nothing to install.

## What is in the package

`scripts/package.sh` (run on your own machine, see README.md) builds `dist/lounge-<date>.zip`. It holds one folder, `edutechready/`:

```
edutechready/
  index.html, results.html, facilitator.html
  css/  js/  vendor/  assets/  content/
  api/          submit.php, results.php, lib.php, .htaccess, .user.ini
  private/      config.example.php, .htaccess   (never served)
  db/           schema.mysql.sql, schema.sqlite.sql, .htaccess   (never served)
  .htaccess     security headers, dotfile and *.md denial
  DEPLOY.md     this file (never served)
  README.md     project description and the licence of each part (never served)
  LICENSE       the GNU AGPL-3.0 text (code licence)
```

The developer pages (`public/dev/`), the real `private/config.php` and any SQLite database are never in the package.

### Why `private/` and `db/` sit inside the game folder

Many shared hosts have no space outside the web root, so by default the settings file lives in a folder the web server could serve. Two things keep it safe:

1. `private/.htaccess` and `db/.htaccess` deny every request (`Require all denied` on Apache 2.4, with an `Order`/`Deny` fallback for Apache 2.2).
2. `config.php` is a PHP file that only returns an array. Even if the denial failed, requesting it would run it and print nothing.

In the repository, `private/` and `db/` sit next to `public/`, one level above the API, and `public/api/lib.php` finds the settings through `LOUNGE_CONFIG_PATH = __DIR__ . '/../../private/config.php'`. The package puts them inside the game folder instead, so `package.sh` rewrites that constant in the packaged `api/lib.php` to `__DIR__ . '/../private/config.php'` (and the SQLite schema path the same way). You do not need to edit anything.

### The alternative: settings outside the web root

On a host that has a folder outside the web root (for example `/home/USER/private/`), that is the safer place, because then no web server setting can ever expose the file:

1. Upload `private/config.php` to that folder instead, and delete `private/` from the game folder.
2. In `api/lib.php` on the server, set the constant to the full path: `const LOUNGE_CONFIG_PATH = '/home/USER/private/config.php';`
3. `db/` holds only the schema files; you can leave it out of the upload once the tables exist.

## Before the first upload

You need: the zip, an FTP or file manager login for the host, and access to the host's control panel for MySQL (phpMyAdmin or similar).

1. **Build the package** on your own machine: `scripts/package.sh`. It prints the path of the zip. Unzip it.
2. **Create the database and a user** in the host's control panel. Give the user rights on that database only: SELECT, INSERT and DELETE are all the API needs (create the tables in step 3 with the control panel's own login, or give the user CREATE for that step). Note the host name (often `localhost`), the database name, the user name and the password.
3. **Create the tables**: open `edutechready/db/schema.mysql.sql`, and run its contents in phpMyAdmin's SQL tab for the new database (or `mysql -u USER -p DBNAME < schema.mysql.sql` if you have a shell). You should see two tables, `submissions` and `placements`.
4. **Create `private/config.php`**: copy `edutechready/private/config.example.php` to `edutechready/private/config.php` and fill in the `dsn` (host and database name), `user` and `password`. Leave `api_enabled` as `true`.
   - Save it as UTF-8 **without BOM**, with nothing before `<?php`. (The API ignores and logs stray output from the file, but clean is better.)
   - Do not put `config.php` anywhere else; only `private/` is denied.

## Upload

5. Upload the **contents** of the unzipped `edutechready/` folder into the site's `/edutechready/` folder, so that `index.html` ends up at `/edutechready/index.html` and the API at `/edutechready/api/submit.php`.
   - Many FTP clients hide files whose names start with a dot. Make sure `.htaccess` (four of them: the game folder, `api/`, `private/`, `db/`) and `api/.user.ini` are uploaded. Turn on "show hidden files" if needed.
   - On a later update, upload everything again except `private/config.php`, which you keep.
6. Open your address (for example <https://example.org/edutechready/>) in a browser. The loading bar should run and the lounge should appear.

### If the site answers 500

Each `.htaccess` block is guarded with `<IfModule>`, so a missing Apache module skips the block. A 500 after the upload usually means the host does not allow one of the directives in `.htaccess` (`AllowOverride`). Check the host's error log, then:

- A 500 on every page: remove the line or block from `/edutechready/.htaccess` that the log names (most likely the `Header` block; the pages still carry the security policy as a `<meta>` tag).
- A 500 only on `api/`: delete the `LimitRequestBody` line from `api/.htaccess`. Any `AllowOverride` class allows it (not only `All`; tested on Apache 2.4 with `Limit`, `FileInfo` and `AuthConfig` alone), so this is only likely where the host allows a fixed list of directives (`AllowOverrideList`). `submit.php` still enforces `max_body_bytes` itself.

### If the host is not Apache

LiteSpeed reads `.htaccess` files like Apache. On nginx, `.htaccess` files do nothing: ask the host to deny `/edutechready/private/` and `/edutechready/db/`, or use the alternative above. The smoke test below shows which case you are in.

## Smoke test

Run these from a terminal on your own machine after each upload. They use only `curl`. Expected results are on the right. Set the base address once:

```sh
BASE=https://example.org/edutechready   # your own address, no trailing slash
```

### Pages and headers

```sh
curl -sI "$BASE/index.html" | grep -iE '^(HTTP|content-security-policy|referrer-policy|x-content-type-options)'
```

Expect `HTTP/... 200`, a `content-security-policy` header that ends with `frame-ancestors 'none'`, `referrer-policy: no-referrer` and `x-content-type-options: nosniff`. If the three headers are missing, `mod_headers` is not active; the game still works and the pages still carry the policy as a `<meta>` tag, but framing is not blocked.

```sh
for p in index.html js/main.js css/main.css content/characters.json assets/portraits/mette.webp; do
  printf '%-26s ' "$p"; curl -sI "$BASE/$p" | grep -i '^cache-control' || echo '(none)'
done
```

Expect `cache-control: no-cache` on each line. It makes browsers check for a newer copy on every load, so an upload or a content edit shows at once. Without it (`(none)`, `mod_headers` is not active), a returning browser can keep old files for days; the game itself still fetches its content files with `no-cache`, but after an upload of new code, a hard reload (Ctrl+Shift+R, Cmd+Shift+R on a Mac) may be needed.

### Private files are denied

Each line should print `403` (or `404`). A `200` means the folder is exposed: stop and fix it before the workshop (see "If the host is not Apache").

```sh
for p in private/config.php private/config.example.php private/.htaccess \
            db/schema.mysql.sql db/schema.sqlite.sql .htaccess api/.htaccess api/.user.ini DEPLOY.md; do
  printf '%-28s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "$BASE/$p"
done
curl -s -o /dev/null -w 'api/lib.php                  %{http_code}\n' "$BASE/api/lib.php"   # 404 (lib.php refuses direct requests)
```

### The API answers, and MySQL works (first run)

Local runs and tests use SQLite, so these checks are the first time the API talks to MySQL. Run them in this order.

1. Results for an unknown session (reads the database):

   ```sh
   curl -s "$BASE/api/results.php?session=TEST22"
   ```

   Expect `{"ok":true,"session":"TEST22","n":0,"characters":{...}}` with an empty `samr` and `rogers` list for each of the eight characters. `{"ok":false,"error":"server"}` means the config or the database is wrong: check the host's PHP error log for a line starting with `[lounge-api]` (a wrong password, host or database name, or missing tables).

2. A real submission to a test session (writes to the database). This is one full set of placements for all eight characters:

   ```sh
   CLIENT=$(uuidgen | tr 'A-Z' 'a-z')
   P='{"samr":40,"rogers":50}'
   curl -s -X POST -H 'Content-Type: application/json' "$BASE/api/submit.php" \
     -d "{\"session\":\"TEST22\",\"clientId\":\"$CLIENT\",\"placements\":{\"mette\":$P,\"jonas\":$P,\"karim\":$P,\"anne\":$P,\"sofie\":$P,\"lars\":$P,\"birgitte\":$P,\"henrik\":$P}}"
   ```

   Expect `{"ok":true}`. Run the same `curl` again (same `CLIENT`): expect `{"ok":false,"error":"already_submitted"}`. If you renamed or added characters in `content/characters.json`, change the ids in the command to match.

3. Results again: `curl -s "$BASE/api/results.php?session=TEST22"` now shows `"n":1` and `[40]` and `[50]` for every character.

4. The test row stays until retention removes it after 30 days. The facilitator page picks codes at random, so a real group could in theory get `TEST22`; to remove the test row, run in phpMyAdmin: first `DELETE FROM placements WHERE submission_id IN (SELECT id FROM submissions WHERE session_code = 'TEST22');`, then `DELETE FROM submissions WHERE session_code = 'TEST22';`.

### Wrong requests are refused

```sh
curl -s -o /dev/null -w 'GET submit.php        %{http_code}\n' "$BASE/api/submit.php"                       # 405
curl -s -o /dev/null -w 'bad session           %{http_code}\n' "$BASE/api/results.php?session=nope"         # 400
head -c 20000 /dev/zero | tr '\0' 'x' > /tmp/lounge-20k.txt
head -c 100000 /dev/zero | tr '\0' 'x' > /tmp/lounge-100k.txt
curl -s -w '  (%{http_code})\n' -X POST -H 'Content-Type: application/json' --data-binary @/tmp/lounge-20k.txt  "$BASE/api/submit.php"   # {"ok":false,"error":"too_large"}  (413)
curl -s -o /dev/null -w '100 KB body           %{http_code}\n' -X POST -H 'Content-Type: application/json' --data-binary @/tmp/lounge-100k.txt "$BASE/api/submit.php"   # 413
rm -f /tmp/lounge-20k.txt /tmp/lounge-100k.txt
```

The 20 KB body is above `max_body_bytes` (16 KiB) and gets the API's own JSON 413. The 100 KB body is above the `LimitRequestBody` of 64 KiB in `api/.htaccess`. Whether Apache itself refuses it depends on how the host runs PHP:

- Under `mod_php`, Apache answers with its own HTML 413 page before PHP starts.
- Under PHP-FPM (Apache passes `.php` requests on with `mod_proxy_fcgi`, the usual setup on hosts that read `.user.ini`), `LimitRequestBody` does not stop requests to `.php` files. This was tested on Apache 2.4.67 with PHP-FPM: a 100 KB and a 2 MB body both reached PHP and got the API's JSON 413 `too_large`; only static files in `api/` got Apache's 413. So under PHP-FPM the body is not capped before PHP: PHP-FPM still receives it, and `submit.php` refuses it. A real cap before PHP then has to come from PHP-FPM itself or the host (ask the host; for a workshop tool this is an accepted risk, like the missing rate limit under "Known limits" below).

Both cases print `413`, so the smoke test cannot tell them apart; `curl -s -X POST --data-binary @/tmp/lounge-100k.txt "$BASE/api/submit.php"` shows which one answered (HTML from Apache, `{"ok":false,"error":"too_large"}` from PHP). If you removed the `LimitRequestBody` line, PHP answers in every setup. The Apache limit is deliberately higher than `max_body_bytes`, so the game always gets the API's JSON answer (`{"ok":false,"error":"too_large"}`); if you ever raise `max_body_bytes`, keep `LimitRequestBody` above it.

### Errors stay out of responses

A response must never contain PHP error text. `api/.user.ini` (PHP-FPM and CGI) and the `mod_php` block in `api/.htaccess` turn `display_errors` off before any script runs, and `lib.php` turns it off again at start-up. To check which PHP setup the host uses, look at the host's control panel (often "PHP-FPM" or "PHP handler"). PHP-FPM reads `.user.ini` changes after up to 5 minutes (`user_ini.cache_ttl`).

### In the browser

7. Open `facilitator.html`, make a session code, open the participant link in two browser windows (or on two laptops), place all characters in each and press Færdig. Both should see "2 par har svaret". Open the projector link: it shows the same two dots per character.

## During and after the workshop

### Switching collection off

Set `'api_enabled' => false` in `private/config.php` on the server (edit and upload the file again). Then:

- `submit.php` and `results.php` both answer `503 {"ok":false,"error":"closed"}`.
- The game runs in practice mode with the notice "Indsamlingen af svar er lukket. I spiller videre i en øverunde …": pairs can still play, nothing is sent.
- **The projector page and the in-game results show "closed" too** ("Indsamlingen af svar er lukket, så resultaterne kan ikke vises lige nu."): `results.php` serves no data while collection is off, so the results of past sessions are no longer visible.

So leave `api_enabled` as `true` until nobody needs the projector view any more (after the workshop's discussion, or after you have saved the projector page with "Gem som PDF"). **Old data is only deleted when a submission arrives.** `submit.php` removes rows older than `retention_days` (30 days) each time it accepts a new submission. While `api_enabled` is `false`, every submission is refused with `503 closed` before that clean-up runs, so nothing is ever deleted; `results.php` only hides old rows, it does not delete them. Even with collection on, the last session's data stays stored until someone submits again after 30 days.

So when you no longer need the projector view, do one of these to keep the 30-day promise:

- **Empty the two tables by hand** (recommended when you switch collection off for good). In phpMyAdmin run, in this order: `DELETE FROM placements;` then `DELETE FROM submissions;`.
- Or switch collection back on later; the first submission after that deletes everything older than 30 days.

To use the game again later, set `api_enabled` back to `true`.

### Known limits (accepted for a workshop tool)

- **No global rate limit**. The API caps each session at `max_submissions_per_session` (200), but nothing limits the number of sessions or requests per visitor. Someone who wanted to could fill a session with fake submissions or, using many invented session codes, grow the database. The data is anonymous, the game has no login, and retention deletes rows older than 30 days on each new submission, so this is accepted for a workshop tool rather than built out. If it ever happens: set `api_enabled` to false, and empty the two tables in phpMyAdmin.
- Two submissions in the very same moment can take a full session one past its cap (no row lock). Harmless at 200.
- `submit.php` accepts any `Content-Type` as long as the body is valid JSON.
