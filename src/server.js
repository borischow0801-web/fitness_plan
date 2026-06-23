import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { z } from 'zod';
import { db, initDb, nowSql, schemaSql } from './db.js';
import { hashPassword, requireAuth, signToken, verifyPassword } from './auth.js';
import { bmi, bmiCategory, completionRateFromSets, goalSummary, toNumberOrNull } from './utils.js';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'please-change-this-secret-before-production')) {
  throw new Error('生产环境必须设置强随机 JWT_SECRET');
}

initDb();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('当前来源不允许访问'));
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(express.static('public'));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const ok = (res, data) => res.json({ data });

function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const current = hits.get(key) || { count: 0, resetAt: now + windowMs };
    if (current.resetAt <= now) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }
    current.count += 1;
    hits.set(key, current);

    if (current.count > max) {
      res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }
    next();
  };
}

const authLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  message: '请求过于频繁，请稍后再试'
});

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || '参数错误' });
    }
    req[source] = parsed.data;
    next();
  };
}

const optionalContact = (schema) => z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  schema.optional()
);

const registerSchema = z.object({
  username: z.string().min(2, '用户名至少 2 个字符').max(40),
  phone: optionalContact(z.string().min(6, '手机号至少 6 位').max(30)),
  email: optionalContact(z.string().email('邮箱格式不正确')),
  password: z.string().min(6, '密码至少 6 位')
}).refine((v) => v.phone || v.email, { message: '手机号或邮箱至少填写一个' });

const loginSchema = z.object({
  account: z.string().min(1, '请输入手机号或邮箱'),
  password: z.string().min(1, '请输入密码')
});

const optionalFreeText = (max = 60) => z.preprocess(
  (value) => (value === '' || value === null ? undefined : String(value).trim()),
  z.string().max(max).optional()
);

const healthSchema = z.object({
  height_cm: z.coerce.number().positive('身高必须大于 0'),
  weight_kg: z.coerce.number().positive('体重必须大于 0'),
  age: z.coerce.number().int().positive().optional().nullable(),
  gender: z.enum(['male', 'female', 'other']).optional().nullable(),
  waist_cm: z.coerce.number().positive().optional().nullable(),
  hip_cm: z.coerce.number().positive().optional().nullable(),
  chest_cm: z.coerce.number().positive().optional().nullable(),
  upper_arm_cm: z.coerce.number().positive().optional().nullable(),
  thigh_cm: z.coerce.number().positive().optional().nullable(),
  calf_cm: z.coerce.number().positive().optional().nullable(),
  body_fat_percent: z.coerce.number().min(0).max(80).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
});

const goalSchema = z.object({
  target_weight_kg: z.coerce.number().positive().optional().nullable(),
  target_loss_kg: z.coerce.number().min(0).optional().nullable(),
  target_waist_cm: z.coerce.number().positive().optional().nullable(),
  target_hip_cm: z.coerce.number().positive().optional().nullable(),
  target_chest_cm: z.coerce.number().positive().optional().nullable(),
  target_upper_arm_cm: z.coerce.number().positive().optional().nullable(),
  target_thigh_cm: z.coerce.number().positive().optional().nullable(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  note: z.string().max(500).optional().nullable()
});

const exerciseSchema = z.object({
  name: z.string().min(1, '动作名称不能为空').max(80),
  target_sets: z.coerce.number().int().min(1).max(30),
  reps_per_set: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  time_value: z.coerce.number().min(0).optional().nullable(),
  time_unit: z.enum(['seconds', 'minutes']).optional().nullable(),
  target_weight: optionalFreeText(60).nullable(),
  target_distance_km: z.coerce.number().min(0).optional().nullable(),
  target_calories: z.coerce.number().int().min(0).optional().nullable(),
  target_intensity: optionalFreeText(40).nullable(),
  rest_seconds: z.coerce.number().int().min(0).optional().nullable(),
  note: z.string().max(300).optional().nullable(),
  sort_order: z.coerce.number().int().min(0).optional().default(0)
});

const planSchema = z.object({
  plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1, '训练标题不能为空').max(80),
  type: z.enum(['strength', 'cardio', 'core', 'recovery', 'rest']),
  note: z.string().max(500).optional().nullable(),
  exercises: z.array(exerciseSchema).optional().default([])
});

const logSchema = z.object({
  plan_id: z.coerce.number().int().positive(),
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rpe: z.coerce.number().int().min(1).max(10).optional().nullable(),
  actual_duration_minutes: z.coerce.number().int().min(0).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  sets: z.array(z.object({
    exercise_id: z.coerce.number().int().positive(),
    set_number: z.coerce.number().int().positive(),
    completed: z.boolean().or(z.coerce.number().int().min(0).max(1)).default(false),
    actual_reps: z.coerce.number().int().min(0).optional().nullable(),
    actual_weight: optionalFreeText(60).nullable(),
    actual_duration_seconds: z.coerce.number().int().min(0).optional().nullable(),
    actual_distance_km: z.coerce.number().min(0).optional().nullable(),
    actual_calories: z.coerce.number().int().min(0).optional().nullable(),
    note: z.string().max(200).optional().nullable()
  })).default([])
});

function publicUser(user) {
  return { id: user.id, username: user.username, phone: user.phone, email: user.email, created_at: user.created_at };
}

function getLatestHealth(userId) {
  return db.prepare('SELECT * FROM health_records WHERE user_id = ? ORDER BY record_date DESC, id DESC LIMIT 1').get(userId);
}

function getLatestGoal(userId) {
  return db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1').get(userId);
}

function getPlanByIdForUser(id, userId) {
  return db.prepare('SELECT * FROM workout_plans WHERE id = ? AND user_id = ?').get(id, userId);
}

function attachExercises(plan) {
  if (!plan) return null;
  return {
    ...plan,
    exercises: db.prepare('SELECT * FROM workout_exercises WHERE plan_id = ? ORDER BY sort_order ASC, id ASC').all(plan.id)
  };
}

function ensurePlan(req, planId) {
  const plan = getPlanByIdForUser(planId, req.user.id);
  if (!plan) {
    const err = new Error('训练计划不存在或无权访问');
    err.status = 404;
    throw err;
  }
  return plan;
}

function localDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeAndStoreLogRate(logId) {
  const sets = db.prepare('SELECT completed FROM exercise_set_logs WHERE workout_log_id = ?').all(logId);
  const rate = completionRateFromSets(sets);
  db.prepare('UPDATE workout_logs SET completion_rate = ?, updated_at = ? WHERE id = ?').run(rate, nowSql(), logId);
  return rate;
}

function saveWorkoutLog(userId, payload, existingLogId = null) {
  return db.transaction((v) => {
    let log;
    if (existingLogId) {
      db.prepare(`UPDATE workout_logs SET rpe=?, actual_duration_minutes=?, note=?, updated_at=? WHERE id=? AND user_id=?`)
        .run(v.rpe, v.actual_duration_minutes, v.note, nowSql(), existingLogId, userId);
      log = db.prepare('SELECT * FROM workout_logs WHERE id = ? AND user_id = ?').get(existingLogId, userId);
    } else {
      db.prepare(`INSERT INTO workout_logs (user_id, plan_id, log_date, rpe, actual_duration_minutes, note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, plan_id, log_date) DO UPDATE SET rpe=excluded.rpe, actual_duration_minutes=excluded.actual_duration_minutes, note=excluded.note, updated_at=excluded.updated_at`)
        .run(userId, v.plan_id, v.log_date, v.rpe, v.actual_duration_minutes, v.note, nowSql());
      log = db.prepare('SELECT * FROM workout_logs WHERE user_id = ? AND plan_id = ? AND log_date = ?').get(userId, v.plan_id, v.log_date);
    }

    const upsertSet = db.prepare(`INSERT INTO exercise_set_logs (workout_log_id, exercise_id, set_number, completed, actual_reps, actual_weight, actual_duration_seconds, actual_distance_km, actual_calories, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workout_log_id, exercise_id, set_number) DO UPDATE SET completed=excluded.completed, actual_reps=excluded.actual_reps, actual_weight=excluded.actual_weight, actual_duration_seconds=excluded.actual_duration_seconds, actual_distance_km=excluded.actual_distance_km, actual_calories=excluded.actual_calories, note=excluded.note, updated_at=excluded.updated_at`);
    v.sets.forEach((setLog) => upsertSet.run(log.id, setLog.exercise_id, setLog.set_number, setLog.completed ? 1 : 0, setLog.actual_reps, setLog.actual_weight, setLog.actual_duration_seconds, setLog.actual_distance_km, setLog.actual_calories, setLog.note, nowSql()));
    computeAndStoreLogRate(log.id);
    return log.id;
  })(payload);
}

app.get('/api/schema.sql', (_req, res) => {
  res.type('text/plain').send(schemaSql.trim());
});

app.post('/api/auth/register', authLimiter, validate(registerSchema), (req, res) => {
  const { username, phone, email, password } = req.body;
  try {
    const result = db.prepare(
      'INSERT INTO users (username, phone, email, password_hash, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(username, phone || null, email || null, hashPassword(password), nowSql());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    ok(res, { token: signToken(user), user: publicUser(user) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ message: '手机号或邮箱已注册' });
    throw error;
  }
});

app.post('/api/auth/login', authLimiter, validate(loginSchema), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ?').get(req.body.account, req.body.account);
  if (!user || !verifyPassword(req.body.password, user.password_hash)) {
    return res.status(401).json({ message: '账号或密码错误' });
  }
  ok(res, { token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => ok(res, { user: req.user }));

app.use('/api', requireAuth);

app.get('/api/health-records', (req, res) => {
  const rows = db.prepare('SELECT *, bmi AS bmi_value FROM health_records WHERE user_id = ? ORDER BY record_date DESC, id DESC').all(req.user.id);
  ok(res, rows.map((row) => ({ ...row, bmi_category: bmiCategory(row.bmi) })));
});

app.post('/api/health-records', validate(healthSchema), (req, res) => {
  const v = req.body;
  const value = bmi(v.weight_kg, v.height_cm);
  const result = db.prepare(`INSERT INTO health_records
    (user_id, height_cm, weight_kg, age, gender, waist_cm, hip_cm, chest_cm, upper_arm_cm, thigh_cm, calf_cm, body_fat_percent, bmi, note, record_date, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, v.height_cm, v.weight_kg, v.age, v.gender, v.waist_cm, v.hip_cm, v.chest_cm, v.upper_arm_cm, v.thigh_cm, v.calf_cm, v.body_fat_percent, value, v.note, v.record_date, nowSql());
  const row = db.prepare('SELECT * FROM health_records WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, req.user.id);
  ok(res, { ...row, bmi_category: bmiCategory(row.bmi) });
});

app.put('/api/health-records/:id', validate(healthSchema), (req, res) => {
  const v = req.body;
  const value = bmi(v.weight_kg, v.height_cm);
  const result = db.prepare(`UPDATE health_records SET
    height_cm=?, weight_kg=?, age=?, gender=?, waist_cm=?, hip_cm=?, chest_cm=?, upper_arm_cm=?, thigh_cm=?, calf_cm=?, body_fat_percent=?, bmi=?, note=?, record_date=?, updated_at=?
    WHERE id=? AND user_id=?`)
    .run(v.height_cm, v.weight_kg, v.age, v.gender, v.waist_cm, v.hip_cm, v.chest_cm, v.upper_arm_cm, v.thigh_cm, v.calf_cm, v.body_fat_percent, value, v.note, v.record_date, nowSql(), req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ message: '记录不存在' });
  ok(res, db.prepare('SELECT * FROM health_records WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id));
});

app.delete('/api/health-records/:id', (req, res) => {
  const result = db.prepare('DELETE FROM health_records WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ message: '记录不存在' });
  ok(res, { deleted: true });
});

app.get('/api/goals', (req, res) => {
  const rows = db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(req.user.id);
  const latestHealth = getLatestHealth(req.user.id);
  ok(res, rows.map((goal) => ({ ...goal, summary: goalSummary(goal, latestHealth) })));
});

app.post('/api/goals', validate(goalSchema), (req, res) => {
  const h = getLatestHealth(req.user.id);
  const v = req.body;
  const result = db.prepare(`INSERT INTO goals
    (user_id, target_weight_kg, target_loss_kg, target_waist_cm, target_hip_cm, target_chest_cm, target_upper_arm_cm, target_thigh_cm, target_date, note, start_weight_kg, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, v.target_weight_kg, v.target_loss_kg, v.target_waist_cm, v.target_hip_cm, v.target_chest_cm, v.target_upper_arm_cm, v.target_thigh_cm, v.target_date, v.note, h?.weight_kg ?? null, nowSql());
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, req.user.id);
  ok(res, { ...goal, summary: goalSummary(goal, h) });
});

app.put('/api/goals/:id', validate(goalSchema), (req, res) => {
  const v = req.body;
  const result = db.prepare(`UPDATE goals SET target_weight_kg=?, target_loss_kg=?, target_waist_cm=?, target_hip_cm=?, target_chest_cm=?, target_upper_arm_cm=?, target_thigh_cm=?, target_date=?, note=?, updated_at=? WHERE id=? AND user_id=?`)
    .run(v.target_weight_kg, v.target_loss_kg, v.target_waist_cm, v.target_hip_cm, v.target_chest_cm, v.target_upper_arm_cm, v.target_thigh_cm, v.target_date, v.note, nowSql(), req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ message: '目标不存在' });
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  ok(res, { ...goal, summary: goalSummary(goal, getLatestHealth(req.user.id)) });
});

app.get('/api/workout-plans', (req, res) => {
  const { date, type } = req.query;
  const clauses = ['user_id = ?'];
  const params = [req.user.id];
  if (date) { clauses.push('plan_date = ?'); params.push(date); }
  if (type) { clauses.push('type = ?'); params.push(type); }
  const plans = db.prepare(`SELECT * FROM workout_plans WHERE ${clauses.join(' AND ')} ORDER BY plan_date DESC, id DESC`).all(...params);
  ok(res, plans.map(attachExercises));
});


app.get('/api/workout-plans/date/:date', (req, res) => {
  const plans = db.prepare('SELECT * FROM workout_plans WHERE user_id = ? AND plan_date = ? ORDER BY id ASC').all(req.user.id, req.params.date).map(attachExercises);
  if (req.query.first === '1') return ok(res, plans[0] || null);
  ok(res, plans);
});

app.get('/api/workout-plans/:id', (req, res) => {
  const plan = getPlanByIdForUser(req.params.id, req.user.id);
  if (!plan) return res.status(404).json({ message: '训练计划不存在' });
  ok(res, attachExercises(plan));
});

app.post('/api/workout-plans', validate(planSchema), (req, res) => {
  const tx = db.transaction((v) => {
    const result = db.prepare('INSERT INTO workout_plans (user_id, plan_date, title, type, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, v.plan_date, v.title, v.type, v.note, nowSql());
    const planId = result.lastInsertRowid;
    const insertExercise = db.prepare(`INSERT INTO workout_exercises
      (plan_id, name, target_sets, reps_per_set, time_value, time_unit, target_weight, target_distance_km, target_calories, target_intensity, rest_seconds, note, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    v.exercises.forEach((e, index) => insertExercise.run(planId, e.name, e.target_sets, e.reps_per_set, e.time_value, e.time_unit, e.target_weight, e.target_distance_km, e.target_calories, e.target_intensity, e.rest_seconds, e.note, e.sort_order ?? index, nowSql()));
    return planId;
  });
  const planId = tx(req.body);
  ok(res, attachExercises(getPlanByIdForUser(planId, req.user.id)));
});

app.put('/api/workout-plans/:id', validate(planSchema), (req, res) => {
  ensurePlan(req, req.params.id);
  const tx = db.transaction((v) => {
    db.prepare('UPDATE workout_plans SET plan_date=?, title=?, type=?, note=?, updated_at=? WHERE id=? AND user_id=?')
      .run(v.plan_date, v.title, v.type, v.note, nowSql(), req.params.id, req.user.id);
    db.prepare('DELETE FROM workout_exercises WHERE plan_id = ?').run(req.params.id);
    const insertExercise = db.prepare(`INSERT INTO workout_exercises
      (plan_id, name, target_sets, reps_per_set, time_value, time_unit, target_weight, target_distance_km, target_calories, target_intensity, rest_seconds, note, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    v.exercises.forEach((e, index) => insertExercise.run(req.params.id, e.name, e.target_sets, e.reps_per_set, e.time_value, e.time_unit, e.target_weight, e.target_distance_km, e.target_calories, e.target_intensity, e.rest_seconds, e.note, e.sort_order ?? index, nowSql()));
  });
  tx(req.body);
  ok(res, attachExercises(getPlanByIdForUser(req.params.id, req.user.id)));
});

app.delete('/api/workout-plans/:id', (req, res) => {
  const result = db.prepare('DELETE FROM workout_plans WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ message: '训练计划不存在' });
  ok(res, { deleted: true });
});

app.post('/api/workout-plans/:planId/exercises', validate(exerciseSchema), (req, res) => {
  ensurePlan(req, req.params.planId);
  const e = req.body;
  const result = db.prepare(`INSERT INTO workout_exercises (plan_id, name, target_sets, reps_per_set, time_value, time_unit, target_weight, target_distance_km, target_calories, target_intensity, rest_seconds, note, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.params.planId, e.name, e.target_sets, e.reps_per_set, e.time_value, e.time_unit, e.target_weight, e.target_distance_km, e.target_calories, e.target_intensity, e.rest_seconds, e.note, e.sort_order, nowSql());
  ok(res, db.prepare('SELECT * FROM workout_exercises WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/exercises/:id', validate(exerciseSchema), (req, res) => {
  const existing = db.prepare(`SELECT e.* FROM workout_exercises e JOIN workout_plans p ON p.id = e.plan_id WHERE e.id = ? AND p.user_id = ?`).get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ message: '动作不存在' });
  const e = req.body;
  db.prepare(`UPDATE workout_exercises SET name=?, target_sets=?, reps_per_set=?, time_value=?, time_unit=?, target_weight=?, target_distance_km=?, target_calories=?, target_intensity=?, rest_seconds=?, note=?, sort_order=?, updated_at=? WHERE id=?`)
    .run(e.name, e.target_sets, e.reps_per_set, e.time_value, e.time_unit, e.target_weight, e.target_distance_km, e.target_calories, e.target_intensity, e.rest_seconds, e.note, e.sort_order, nowSql(), req.params.id);
  ok(res, db.prepare('SELECT * FROM workout_exercises WHERE id = ?').get(req.params.id));
});

app.delete('/api/exercises/:id', (req, res) => {
  const existing = db.prepare(`SELECT e.* FROM workout_exercises e JOIN workout_plans p ON p.id = e.plan_id WHERE e.id = ? AND p.user_id = ?`).get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ message: '动作不存在' });
  db.prepare('DELETE FROM workout_exercises WHERE id = ?').run(req.params.id);
  ok(res, { deleted: true });
});

function getLog(userId, date, planId = null) {
  const log = planId
    ? db.prepare('SELECT * FROM workout_logs WHERE user_id = ? AND log_date = ? AND plan_id = ? ORDER BY id DESC LIMIT 1').get(userId, date, planId)
    : db.prepare('SELECT * FROM workout_logs WHERE user_id = ? AND log_date = ? ORDER BY id DESC LIMIT 1').get(userId, date);
  if (!log) return null;
  const sets = db.prepare('SELECT * FROM exercise_set_logs WHERE workout_log_id = ? ORDER BY exercise_id, set_number').all(log.id);
  return { ...log, sets };
}

app.get('/api/workout-logs/date/:date', (req, res) => ok(res, getLog(req.user.id, req.params.date, req.query.plan_id || null)));

app.get('/api/workout-logs/plan/:planId/date/:date', (req, res) => {
  ensurePlan(req, req.params.planId);
  ok(res, getLog(req.user.id, req.params.date, req.params.planId));
});

app.post('/api/workout-logs', validate(logSchema), (req, res) => {
  ensurePlan(req, req.body.plan_id);
  saveWorkoutLog(req.user.id, req.body);
  ok(res, getLog(req.user.id, req.body.log_date, req.body.plan_id));
});

app.put('/api/workout-logs/:id', validate(logSchema), (req, res) => {
  const existing = db.prepare('SELECT * FROM workout_logs WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ message: '训练日志不存在' });
  req.body.plan_id = existing.plan_id;
  saveWorkoutLog(req.user.id, req.body, existing.id);
  ok(res, getLog(req.user.id, req.body.log_date, existing.plan_id));
});

app.get('/api/dashboard', (req, res) => {
  const today = localDate();
  const latestHealth = getLatestHealth(req.user.id);
  const latestGoal = getLatestGoal(req.user.id);
  const todayPlans = db.prepare('SELECT * FROM workout_plans WHERE user_id = ? AND plan_date = ? ORDER BY id ASC').all(req.user.id, today).map(attachExercises);
  const todayLogs = db.prepare('SELECT * FROM workout_logs WHERE user_id = ? AND log_date = ? ORDER BY id ASC').all(req.user.id, today);
  const logsByPlan = new Map(todayLogs.map((log) => [Number(log.plan_id), log]));
  const avgRate = todayPlans.length
    ? Math.round((todayPlans.reduce((sum, plan) => sum + Number(logsByPlan.get(Number(plan.id))?.completion_rate || 0), 0) / todayPlans.length) * 10) / 10
    : 0;
  const todayPlan = todayPlans[0] || null;
  const todayLog = todayLogs[0] || null;
  const recentTraining = db.prepare(`SELECT log_date, AVG(completion_rate) AS completion_rate FROM workout_logs WHERE user_id = ? GROUP BY log_date ORDER BY log_date DESC LIMIT 7`).all(req.user.id).reverse();
  ok(res, {
    today,
    today_plan: todayPlan,
    today_plans: todayPlans,
    today_log: todayLog,
    today_logs: todayLogs,
    today_completion_rate: avgRate,
    latest_health: latestHealth ? { ...latestHealth, bmi_category: bmiCategory(latestHealth.bmi) } : null,
    latest_goal: latestGoal ? { ...latestGoal, summary: goalSummary(latestGoal, latestHealth) } : null,
    recent_training: recentTraining
  });
});

app.get('/api/history/workouts', (req, res) => {
  const { date, type } = req.query;
  const clauses = ['p.user_id = ?'];
  const params = [req.user.id];
  if (date) { clauses.push('p.plan_date = ?'); params.push(date); }
  if (type) { clauses.push('p.type = ?'); params.push(type); }
  const rows = db.prepare(`SELECT p.*, l.completion_rate, l.rpe, l.actual_duration_minutes
    FROM workout_plans p LEFT JOIN workout_logs l ON l.plan_id = p.id AND l.user_id = p.user_id
    WHERE ${clauses.join(' AND ')} ORDER BY p.plan_date DESC, p.id DESC`).all(...params);
  ok(res, rows);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || '服务器错误' });
});

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 9001);
app.listen(port, host, () => {
  console.log(`Fitness plan app running at http://${host}:${port}`);
});
