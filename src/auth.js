import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, jwtSecret, { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: '请先登录' });

  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = db.prepare('SELECT id, username, phone, email, created_at FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ message: '登录已失效，请重新登录' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: '登录已失效，请重新登录' });
  }
}
