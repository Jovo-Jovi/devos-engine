import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/schema.ts',
  out: './supabase/migrations',
  dialect: 'postgresql',
});
