-- ============================================================
-- Multi-Auth Attendance System — Database Schema
-- Engine: MySQL / MariaDB (InnoDB)
-- Import via phpMyAdmin or: mysql -u root -p < schema.sql
-- ============================================================

DROP DATABASE multi_auth_attendance;
CREATE DATABASE multi_auth_attendance;
USE multi_auth_attendance;

CREATE DATABASE IF NOT EXISTS multi_auth_attendance
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE multi_auth_attendance;

-- ----------------------------------------------------------
-- USERS  (employees, students, admins)
-- ----------------------------------------------------------
CREATE TABLE users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_code       VARCHAR(20)  NOT NULL UNIQUE,      -- e.g. EMP-1002, STU-5021, ADM-1001
  full_name       VARCHAR(120) NOT NULL,
  email           VARCHAR(150) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('admin','employee','student') NOT NULL DEFAULT 'employee',
  department      VARCHAR(120) DEFAULT NULL,          -- e.g. Software Engineering, CS Class 2026
  photo_path      VARCHAR(255) DEFAULT NULL,
  shift_start     TIME DEFAULT '09:00:00',
  shift_end       TIME DEFAULT '17:30:00',
  qr_secret       VARCHAR(64)  NOT NULL,               -- encoded into the user's dynamic QR badge
  face_enrolled   TINYINT(1)   NOT NULL DEFAULT 0,      -- has a face template been captured
  face_template   TEXT DEFAULT NULL,                    -- placeholder for stored face descriptor (JSON)
  fingerprint_enrolled TINYINT(1) NOT NULL DEFAULT 0,   -- WebAuthn credential registered
  webauthn_credential_id VARCHAR(255) DEFAULT NULL,
  status          ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- GEOFENCES  (campuses / offices allowed for GPS check-in)
-- ----------------------------------------------------------
CREATE TABLE geofences (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  address     VARCHAR(255) NOT NULL,
  latitude    DECIMAL(10,6) NOT NULL,
  longitude   DECIMAL(10,6) NOT NULL,
  radius_m    INT NOT NULL DEFAULT 150,      -- allowed radius in meters
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- SYSTEM SETTINGS  (MFA toggle, grace period, etc.)
-- ----------------------------------------------------------
CREATE TABLE settings (
  setting_key   VARCHAR(60) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

INSERT INTO settings (setting_key, setting_value) VALUES
  ('require_mfa', '1'),
  ('grace_period_minutes', '15'),
  ('required_face_match_pct', '85'),
  ('mfa_methods_required', '3');   -- QR + GPS + FACE by default

-- ----------------------------------------------------------
-- COURSE ATTENDANCE SESSIONS
-- ----------------------------------------------------------
CREATE TABLE attendance_sessions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  course_code  VARCHAR(40) NOT NULL,
  course_name  VARCHAR(160) NOT NULL,
  starts_at    DATETIME NOT NULL,
  ends_at      DATETIME NOT NULL,
  latitude     DECIMAL(10,6) NOT NULL,
  longitude    DECIMAL(10,6) NOT NULL,
  radius_m     INT NOT NULL DEFAULT 100,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_by   INT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- ATTENDANCE LOGS
-- ----------------------------------------------------------
CREATE TABLE attendance_logs (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT NOT NULL,
  session_id        INT DEFAULT NULL,
  geofence_id       INT DEFAULT NULL,
  check_in_time     DATETIME NOT NULL,
  status            ENUM('on_time','late','geofence_violation','face_mismatch') NOT NULL,
  methods_used      VARCHAR(120) NOT NULL,       -- e.g. "QR,GPS,FACE"
  gps_lat           DECIMAL(10,6) DEFAULT NULL,
  gps_lng           DECIMAL(10,6) DEFAULT NULL,
  gps_distance_m    INT DEFAULT NULL,
  face_match_pct    DECIMAL(5,2) DEFAULT NULL,
  qr_verified       TINYINT(1) DEFAULT 0,
  fingerprint_verified TINYINT(1) DEFAULT 0,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- LEAVE / ABSENCE REQUESTS
-- ----------------------------------------------------------
CREATE TABLE leave_requests (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  leave_type    ENUM('sick','vacation','emergency','other') NOT NULL DEFAULT 'other',
  reason        VARCHAR(255) NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by   INT DEFAULT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- SEED DATA — matches the checkpoint UI screenshots
-- ============================================================
-- Geofences below are REAL pins pulled from Google Maps/Places for BOUESTI
-- (Bamidele Olumilua University of Education, Science and Technology, Ikere-Ekiti):
--   1. Main Campus              — Ogotun / Ipetu-Ijesha Road (231 Google reviews)
--   2. College of Technology    — separate campus site, Igbara-Odo Road, Km 6
--   3. Hall A / Hall B / Hall C — student hostels on Apata Hill (Hall C = your hall)
-- 5m is a TIGHT radius for consumer GPS (typical accuracy is 3–15m outdoors).
-- If real check-ins get rejected near the venue, widen the radius from
-- Admin → Geofences rather than editing this file. You can also use the
-- "Use My Current GPS" button there to recapture any pin more precisely by
-- physically standing at the entrance you want to gate — Google's building-level
-- pins are accurate but not survey-grade.
INSERT INTO geofences (name, address, latitude, longitude, radius_m) VALUES
 ('BOUESTI Main Campus', 'Ogotun, Ipetu-Ijesha Road, Ikere-Ekiti 361101, Ekiti, Nigeria', 7.496295, 5.171304, 5),
 ('BOUESTI College of Technology', 'Kilometer 6, Igbara-Odo Road, Ikere 361102, Ekiti, Nigeria', 7.503843, 5.062501, 5),
 ('Bouesti Hall A (Hostel)', 'Hall A, Ikere-Ogotun-Ipetu Ijesha Road, Apata Hill, Ikere-Ekiti 361101, Ekiti, Nigeria', 7.493033, 5.175210, 5),
 ('Bouesti Hall B (Hostel)', 'Hall B, Ikere-Ogotun-Ipetu Ijesha Road, Apata Hill, Ikere-Ekiti 361101, Ekiti, Nigeria', 7.492231, 5.175023, 5),
 ('Bouesti Hall C (Hostel)', 'F5VG+FQ7 College of Education, Ikere-Ekiti 361101, Ekiti, Nigeria', 7.493664, 5.176935, 5);

-- password_hash placeholders below are overwritten by includes/seed_helper.php:
--   admin@tech.com          -> password: admin
--   all other seeded users  -> password: Password123!
INSERT INTO users (user_code, full_name, email, password_hash, role, department, shift_start, shift_end, qr_secret, face_enrolled, fingerprint_enrolled) VALUES
 ('ADM-1001', 'Dr. Sarah Connor', 'admin@tech.com',              '$2y$10$abcdefghijklmnopqrstuv', 'admin',    'System Security & HR',     '09:00:00','17:30:00', 'QR-ADM1001-SECRET', 0, 0),
 ('EMP-1002', 'Alex Rivera',      'alex.rivera@omniauth.test',  '$2y$10$abcdefghijklmnopqrstuv', 'employee', 'Software Engineering',     '09:00:00','17:30:00', 'QR-EMP1002-SECRET', 0, 0),
 ('STU-5021', 'Elena Rostova',    'elena.rostova@omniauth.test','$2y$10$abcdefghijklmnopqrstuv', 'student',  'CS Class 2026',            '09:00:00','17:30:00', 'QR-STU5021-SECRET', 0, 0),
 ('EMP-1008', 'Marcus Vance',     'marcus.vance@omniauth.test', '$2y$10$abcdefghijklmnopqrstuv', 'employee', 'Product Operations',       '09:00:00','17:30:00', 'QR-EMP1008-SECRET', 0, 0),
 ('STU-5044', 'David Chen',       'david.chen@omniauth.test',   '$2y$10$abcdefghijklmnopqrstuv', 'student',  'Data Science 2026',        '09:00:00','17:30:00', 'QR-STU5044-SECRET', 0, 0);

-- Face templates are intentionally left NULL for seed accounts — a real 128-point
-- face descriptor can only be captured from an actual live camera (see register.php),
-- so seeded demo users start with face_enrolled = 0 until they enroll for real.

-- Face-matching threshold: face-api.js descriptor distance, NOT a percentage.
-- ~0.6 or below is generally considered the same person; store as a setting so
-- the admin can tune sensitivity without touching code.
INSERT INTO settings (setting_key, setting_value) VALUES
  ('face_distance_threshold', '0.6');
