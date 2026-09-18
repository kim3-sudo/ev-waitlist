import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    req.admin = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
