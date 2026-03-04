import { createCipheriv, createHash, randomBytes } from 'node:crypto';

function deriveKey(secret) {
	return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSecretValue(value, secret) {
	if (!secret || secret.length < 16) {
		throw new Error('Missing or weak USER_API_KEYS_ENCRYPTION_SECRET');
	}
	const iv = randomBytes(12);
	const key = deriveKey(secret);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		alg: 'aes-256-gcm',
		v: 1,
		ciphertext: encrypted.toString('base64'),
		iv: iv.toString('base64'),
		tag: tag.toString('base64')
	};
}

