import { jest } from '@jest/globals';
import { loadConfig } from '../src/config/index.js';

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should parse valid environment variables', () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
    process.env.PORT = '8080';

    const config = loadConfig();
    
    expect(config.NODE_ENV).toBe('test');
    expect(config.FRONTEND_ORIGIN).toBe('http://localhost:3000');
    expect(config.PORT).toBe(8080);
  });

  it('should throw error when missing required variables', () => {
    delete process.env.FRONTEND_ORIGIN;
    
    const exitMock = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`Process exited with code ${code}`);
    });
    
    expect(() => loadConfig()).toThrow('Process exited with code 1');

    expect(exitMock).toHaveBeenCalledWith(1);
    
    exitMock.mockRestore();
  });
});
