import { encrypt, decrypt } from "../src/security/encryption";
import assert from "assert";

// Mock env var
process.env.ENCRYPTION_KEY = "0000000000000000000000000000000000000000000000000000000000000000"; // 32 bytes hex = 64 chars

console.log("Testing Encryption...");

const text = "my-secret-token";
const encrypted = encrypt(text);
console.log(`Encrypted: ${encrypted}`);

assert.notEqual(text, encrypted);
assert.ok(encrypted.includes(":"), "Encrypted text should contain IV and Tag separator");

const decrypted = decrypt(encrypted);
console.log(`Decrypted: ${decrypted}`);

assert.strictEqual(text, decrypted);

console.log("Encryption Test Passed!");
