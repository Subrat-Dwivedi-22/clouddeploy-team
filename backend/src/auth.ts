import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
