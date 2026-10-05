import { type Algorithm, hash, verify } from '@node-rs/argon2';

// Algorithm is an ambient const enum (unusable under isolatedModules); 2 === Algorithm.Argon2id.
const ARGON2ID = 2 as Algorithm;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, { algorithm: ARGON2ID });
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}
