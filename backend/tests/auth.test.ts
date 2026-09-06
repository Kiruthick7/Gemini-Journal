import { jest } from '@jest/globals';
import { authenticate } from '../src/middleware/auth.middleware.js';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../src/errors/AppError.js';
import { auth } from '../src/utils/firebase.js';
import { DecodedIdToken } from 'firebase-admin/auth';

// No module mock needed, we will spy on the imported auth object

describe('Auth Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {};
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  it('should throw 401 if Authorization header is missing', async () => {
    await authenticate(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = mockNext.mock.calls[0][0] as any;
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/Missing or malformed/);
  });

  it('should throw 401 if token is malformed', async () => {
    mockReq.headers!.authorization = 'Basic somestuff';
    await authenticate(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
  });

  it('adds user to request if token is valid', async () => {
    mockReq.headers = { authorization: 'Bearer valid_token' };
    jest.spyOn(auth, 'verifyIdToken').mockResolvedValue({ uid: 'user123' } as unknown as DecodedIdToken);

    await authenticate(mockReq as Request, mockRes as Response, mockNext);
    
    expect(mockReq.user).toBeDefined();
    expect(mockReq.user!.uid).toBe('user123');
    expect(mockNext).toHaveBeenCalledWith(); // Called with no arguments (success)
  });

  it('should throw 401 TOKEN_EXPIRED on expired token', async () => {
    mockReq.headers!.authorization = 'Bearer expiredtoken';
    jest.spyOn(auth, 'verifyIdToken').mockRejectedValue({ code: 'auth/id-token-expired' });

    await authenticate(mockReq as Request, mockRes as Response, mockNext);
    
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = mockNext.mock.calls[0][0] as any;
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('TOKEN_EXPIRED');
  });
});
