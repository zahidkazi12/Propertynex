import bcrypt from "bcryptjs";

// bcryptjs is a pure-JS bcrypt implementation. It is used instead of a
// native-binding library (node bcrypt / argon2) so that `npm install` works
// on a plain student machine without a C++ build toolchain, while still
// giving a real, industry-standard, salted adaptive hash — never plaintext,
// never a fast unsalted hash like MD5/SHA256.
const SALT_ROUNDS = 12;

export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
