// Short, lowercase and alphanumeric: it is embedded in Appwrite row ids (`db{nonce}`, `de{nonce}`).
export const defaultNonce = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '').slice(0, 20).toLowerCase();
