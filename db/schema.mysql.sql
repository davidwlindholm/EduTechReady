-- EduTechReady: MySQL / MariaDB schema.
-- Apply once on the server, for example: mysql -u USER -p DBNAME < db/schema.mysql.sql
-- Timestamps are UTC, written by PHP as 'YYYY-MM-DD HH:MM:SS'.
-- No foreign keys or cascades: submit.php deletes a submission's placements
-- in the same transaction as the submission.

CREATE TABLE submissions (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_code CHAR(6)      NOT NULL,
  client_id    CHAR(36)     NOT NULL,
  created_at   DATETIME     NOT NULL,
  UNIQUE KEY uq_session_client (session_code, client_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE placements (
  submission_id INT UNSIGNED NOT NULL,
  character_id  VARCHAR(40)  NOT NULL,
  axis          VARCHAR(6)   NOT NULL,
  value         SMALLINT     NOT NULL,
  PRIMARY KEY (submission_id, character_id, axis)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
