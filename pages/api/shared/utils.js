// Shared utilities for /api endpoints
import cors from 'cors';

export const corsMiddleware = cors({
  origin: '*',
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['*'],
});

export function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}
