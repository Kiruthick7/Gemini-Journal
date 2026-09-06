import { Router } from 'express';
import { accountService } from '../services/account.service.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { AppError } from '../errors/AppError.js';

export const accountRouter = Router();

// 1. DELETE /api/account
accountRouter.delete('/', authenticate, async (req, res, next) => {
  try {
    // strict validation
    const uid = req.user?.uid;
    if (!uid) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    await accountService.deleteAccount(uid);

    res.status(200).json({ status: 'OK', message: 'Account deleted' });
  } catch (error) {
    next(error);
  }
});
