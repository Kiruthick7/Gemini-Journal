import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('8080'),
  FRONTEND_ORIGIN: z.string().url(),
  // Firebase Admin uses application default credentials via GCE/Cloud Run metadata,
  // but we optionally support a project ID override.
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  FIRESTORE_DATABASE_ID: z.string().optional(),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
});

export const loadConfig = () => {
  try {
    const parsed = envSchema.parse(process.env);
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Configuration validation failed:');
      error.errors.forEach(e => {
        console.error(`- ${e.path.join('.')}: ${e.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
};

export const config = loadConfig();
