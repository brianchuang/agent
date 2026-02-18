import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
// Key length for aes-256-gcm is 32 bytes
// We expect the key to be provided as a 64-character hex string (32 bytes)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

function getBufferKey(keyHex: string): Buffer {
  if (!keyHex) {
    throw new Error("ENCRYPTION_KEY is not set.");
  }
  const buffer = Buffer.from(keyHex, 'hex');
  if (buffer.length !== 32) {
    throw new Error(`Invalid ENCRYPTION_KEY length: ${buffer.length} bytes. Expected 32 bytes.`);
  }
  return buffer;
}

export function encrypt(text: string): string {
  const key = getBufferKey(ENCRYPTION_KEY);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(text: string): string {
  const key = getBufferKey(ENCRYPTION_KEY);
  const parts = text.split(':');
  if (parts.length !== 3) {
      throw new Error("Invalid encrypted text format. Expected iv:authTag:encrypted");
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
