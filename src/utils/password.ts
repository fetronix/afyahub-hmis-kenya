import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id as 2,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 12) {
    throw new Error(
      "Password must be at least 12 characters long."
    );
  }

  const hash = await argon2.hash(password, ARGON2_OPTIONS);

  return hash.toString();
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }

  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}