import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbFile = process.env.DB_FILE || './data/fitness.sqlite';
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(phone),
  UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS health_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  height_cm REAL NOT NULL,
  weight_kg REAL NOT NULL,
  age INTEGER,
  gender TEXT CHECK(gender IN ('male','female','other')),
  waist_cm REAL,
  hip_cm REAL,
  chest_cm REAL,
  upper_arm_cm REAL,
  thigh_cm REAL,
  calf_cm REAL,
  body_fat_percent REAL,
  bmi REAL NOT NULL,
  note TEXT,
  record_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  target_weight_kg REAL,
  target_loss_kg REAL,
  target_waist_cm REAL,
  target_hip_cm REAL,
  target_chest_cm REAL,
  target_upper_arm_cm REAL,
  target_thigh_cm REAL,
  target_date TEXT,
  note TEXT,
  start_weight_kg REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan_date TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('strength','cardio','core','recovery','rest')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  target_sets INTEGER NOT NULL DEFAULT 1,
  reps_per_set INTEGER,
  time_value REAL,
  time_unit TEXT CHECK(time_unit IN ('seconds','minutes')),
  target_weight TEXT,
  target_distance_km REAL,
  target_calories INTEGER,
  target_intensity TEXT,
  rest_seconds INTEGER,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES workout_plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  log_date TEXT NOT NULL,
  rpe INTEGER CHECK(rpe BETWEEN 1 AND 10),
  actual_duration_minutes INTEGER,
  note TEXT,
  completion_rate REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, plan_id, log_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES workout_plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exercise_set_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_log_id INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  set_number INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  actual_reps INTEGER,
  actual_weight TEXT,
  actual_duration_seconds INTEGER,
  actual_distance_km REAL,
  actual_calories INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workout_log_id, exercise_id, set_number),
  FOREIGN KEY (workout_log_id) REFERENCES workout_logs(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES workout_exercises(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_health_user_date ON health_records(user_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_plans_user_date ON workout_plans(user_id, plan_date DESC);
CREATE INDEX IF NOT EXISTS idx_logs_user_date ON workout_logs(user_id, log_date DESC);
`;

function columnNames(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function addColumnIfMissing(tableName, columnName, definition) {
  if (!columnNames(tableName).includes(columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function migrateWorkoutPlansAllowMultiplePerDay() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workout_plans'").get();
  if (!row?.sql?.includes('UNIQUE(user_id, plan_date)')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE workout_plans_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan_date TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('strength','cardio','core','recovery','rest')),
        note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO workout_plans_new (id, user_id, plan_date, title, type, note, created_at, updated_at)
      SELECT id, user_id, plan_date, title, type, note, created_at, updated_at FROM workout_plans;
      DROP TABLE workout_plans;
      ALTER TABLE workout_plans_new RENAME TO workout_plans;
    `);
  });
  try {
    migrate();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function initDb() {
  db.exec(schemaSql);
  migrateWorkoutPlansAllowMultiplePerDay();
  addColumnIfMissing('workout_exercises', 'target_distance_km', 'REAL');
  addColumnIfMissing('workout_exercises', 'target_calories', 'INTEGER');
  addColumnIfMissing('workout_exercises', 'target_intensity', 'TEXT');
  addColumnIfMissing('exercise_set_logs', 'actual_distance_km', 'REAL');
  addColumnIfMissing('exercise_set_logs', 'actual_calories', 'INTEGER');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_health_user_date ON health_records(user_id, record_date DESC);
    CREATE INDEX IF NOT EXISTS idx_plans_user_date ON workout_plans(user_id, plan_date DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_user_date ON workout_logs(user_id, log_date DESC);
  `);
}

export function nowSql() {
  return new Date().toISOString();
}
