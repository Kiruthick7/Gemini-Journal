import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: { uid: string };
    }
  }
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const reqId = (req.headers['x-request-id'] as string) || uuidv4();
  // Assign UUID to request using the augmented type
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
};
