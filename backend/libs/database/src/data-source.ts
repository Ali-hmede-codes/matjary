import 'reflect-metadata';
import { loadEnvFile } from 'node:process';
import { DataSource } from 'typeorm';
import { validateDatabaseEnvironment } from '../../config/src/environment';
import { createDatabaseOptions } from './database.options';

// Existing process variables take precedence; .env is optional in deployment.
try {
  loadEnvFile('.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export default new DataSource(
  createDatabaseOptions(validateDatabaseEnvironment(process.env)),
);
