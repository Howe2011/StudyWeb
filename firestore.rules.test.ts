/**
 * Security Rules Verification Spec ("Dirty Dozen" Adversarial Payloads)
 * Maps each attack vector from security_spec.md to the exact rule invariant that denies it.
 */

export interface AdversarialTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email?: string; email_verified?: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
  enforcedBy: string;
}

export const DIRTY_DOZEN_PAYLOADS: AdversarialTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Read/Write',
    operation: 'get',
    path: '/users/alice',
    auth: null,
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isSignedIn() && isVerified() required by isOwner/isAdmin'
  },
  {
    id: 2,
    name: 'Unverified Email Admin Spoof',
    operation: 'create',
    path: '/users/bob',
    auth: { uid: 'bob', email: 'howezhou2011@gmail.com', email_verified: false },
    payload: { uid: 'bob', role: 'admin' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isVerified() requires request.auth.token.email_verified == true'
  },
  {
    id: 3,
    name: 'Self-Assigned Admin Role on Create',
    operation: 'create',
    path: '/users/charlie',
    auth: { uid: 'charlie', email: 'charlie@example.com', email_verified: true },
    payload: {
      uid: 'charlie',
      role: 'admin',
      displayName: 'Charlie',
      encryptionMode: 'passphrase',
      keySalt: '1234567890123456',
      wrappedDek: '1234567890123456',
      wrappedDekIv: '123456789012',
      keyVersion: 1
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: "incoming().role == 'student' || isBootstrapAdmin()"
  },
  {
    id: 4,
    name: 'Role Escalation Shadow Update',
    operation: 'update',
    path: '/users/charlie',
    auth: { uid: 'charlie', email: 'charlie@example.com', email_verified: true },
    payload: { role: 'admin' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().role == existing().role && affectedKeys().hasOnly([...])'
  },
  {
    id: 5,
    name: 'Ghost Field Injection',
    operation: 'create',
    path: '/users/charlie/syncDocs/rev_fc',
    auth: { uid: 'charlie', email: 'charlie@example.com', email_verified: true },
    payload: {
      ownerId: 'charlie',
      app: 'revision',
      chunkKey: 'fc-state',
      chunkIndex: 0,
      totalChunks: 1,
      ciphertext: 'abc',
      iv: '123456789012',
      alg: 'AES-GCM-256',
      checksum: '0123456789abcdef',
      deviceId: 'dev_1',
      deviceName: 'Chrome',
      keyVersion: 1,
      isVerified: true
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isValidEncryptedSyncDoc data.keys().hasOnly([...])'
  },
  {
    id: 6,
    name: 'Owner Spoofing on SyncDoc',
    operation: 'create',
    path: '/users/alice/syncDocs/rev_fc',
    auth: { uid: 'alice', email: 'alice@example.com', email_verified: true },
    payload: { ownerId: 'bob', app: 'revision', chunkKey: 'fc-state' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().ownerId == userId'
  },
  {
    id: 7,
    name: 'Cross-User Private PII Read',
    operation: 'get',
    path: '/users/bob/private/info',
    auth: { uid: 'alice', email: 'alice@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isOwner(userId) || isAdmin()'
  },
  {
    id: 8,
    name: 'Cross-User Sync List Scraping',
    operation: 'list',
    path: '/users/bob/syncDocs',
    auth: { uid: 'alice', email: 'alice@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isOwner(userId) && resource.data.ownerId == request.auth.uid'
  },
  {
    id: 9,
    name: 'Path ID Poisoning',
    operation: 'create',
    path: `/users/alice/syncDocs/${'x'.repeat(200)}$bad`,
    auth: { uid: 'alice', email: 'alice@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: "isValidId(docId) enforces size <= 128 and ^[a-zA-Z0-9_\\-]+$"
  },
  {
    id: 10,
    name: 'Client-Spoofed Timestamp',
    operation: 'create',
    path: '/users/alice/syncDocs/rev_fc',
    auth: { uid: 'alice', email: 'alice@example.com', email_verified: true },
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().createdAt == request.time'
  },
  {
    id: 11,
    name: 'Immutable Owner Mutation',
    operation: 'update',
    path: '/users/alice/syncDocs/rev_fc',
    auth: { uid: 'alice', email: 'alice@example.com', email_verified: true },
    payload: { ownerId: 'bob' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().ownerId == existing().ownerId'
  },
  {
    id: 12,
    name: 'Non-Admin Admin Registry Write',
    operation: 'create',
    path: '/admins/charlie',
    auth: { uid: 'charlie', email: 'charlie@example.com', email_verified: true },
    payload: { uid: 'charlie', grantedBy: 'charlie' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedBy: 'isAdmin() required on /admins/{userId} create'
  }
];
