import { Request, Response, NextFunction } from 'express';
import { auth } from '../utils/firebase.js';
import { AppError } from '../errors/AppError.js';

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Missing or malformed Authorization header', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split('Bearer ')[1];
    if (!token) {
       throw new AppError('Missing token', 401, 'UNAUTHORIZED');
    }

    try {
      const decodedToken = await auth.verifyIdToken(token);
      // Attach strictly ONLY the uid. This is the invariant.
      req.user = {
        uid: decodedToken.uid
      };
      next();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const fbError = error as { code?: string };
      if (fbError.code === 'auth/id-token-expired') {
        throw new AppError('Token expired', 401, 'TOKEN_EXPIRED');
      }
      throw new AppError('Invalid token', 401, 'UNAUTHORIZED');
    }
  } catch (err) {
    next(err);
  }
};
