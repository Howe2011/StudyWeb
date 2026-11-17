# Security Specification: StudyDeck Encrypted Sync & RBAC

## 1. Data Invariants
1. **Strict Ownership & Identity Binding**: Every user-scoped document (`/users/{userId}`, `/users/{userId}/private/{docId}`, `/users/{userId}/syncDocs/{docId}`, `/users/{userId}/devices/{deviceId}`, `/users/{userId}/activity/{activityId}`) must have its `uid`/`ownerId` equal to `request.auth.uid` and `userId`, and requires `request.auth.token.email_verified == true`.
2. **RBAC Privilege Escalation Prevention**: Non-admin users can only create `/users/{userId}` with `role == 'student'`, cannot mutate `role` on update, and cannot write to `/admins/{userId}`.
3. **PII Isolation & Client-Side Encryption**: Sensitive PII (`email`, `fullName`, `school`, `yearGroup`, `studyGoal`) is never stored in plaintext in `/users/{userId}`. It is encrypted client-side with AES-256-GCM and stored in `/users/{userId}/private/info`.
4. **Immutability & Server Timestamps**: `createdAt` must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on both create and update. `uid` and `ownerId` are immutable after creation.
5. **Path ID & Payload Boundary Guards**: All document IDs match `^[a-zA-Z0-9_\-]+$` (`size <= 128`), and every string/number field enforces strict type, enum, and `.size()` bounds.
6. **Community Shared Items & Direct Links (`/sharedItems/{itemId}`)**: Verified owners can publish `notes`, `flashcards`, or `subject` items (`payloadJson <= 450 KB`, initial `copyCount == 0`) as `public` or `unlisted`, edit/delete only their own items (unless admin), while signed-in copiers can only perform an atomic `+1` bump on `copyCount`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Unauthenticated user attempts `get(/users/alice)` or `set(/users/alice/syncDocs/d1, ...)`.
2. **Unverified Email Bypass**: User with `email_verified: false` (even matching admin email) attempts to write `/users/bob` or read `/admins/bob`.
3. **Self-Assigned Admin Role on Create**: Regular user creates `/users/charlie` with `{ role: 'admin', ... }`.
4. **Role Escalation Shadow Update**: Regular user updates `/users/charlie` with `{ role: 'admin', updatedAt: serverTimestamp() }`.
5. **Ghost Field Injection**: User creates `/users/charlie/syncDocs/doc1` with an undeclared field `{ ..., isVerified: true }`.
6. **Owner Spoofing**: User `alice` creates `/users/alice/syncDocs/doc1` with `ownerId: 'bob'`.
7. **Cross-User Private PII Read**: User `alice` attempts `get(/users/bob/private/info)`.
8. **Cross-User Sync List Scraping**: User `alice` attempts `list(/users/bob/syncDocs)`.
9. **Path ID Poisoning (Denial of Wallet)**: User creates `/users/alice/syncDocs/` with a 500-char invalid ID containing `$` or spaces.
10. **Client-Spoofed Timestamp**: User creates `/users/alice/syncDocs/doc1` with `createdAt: Timestamp(2020-01-01)`.
11. **Immutable Owner Mutation**: User updates `/users/alice/syncDocs/doc1` changing `ownerId` or `createdAt`.
12. **Non-Admin Admin Registry Write**: Regular user attempts `set(/admins/charlie, { uid: 'charlie', grantedBy: 'charlie', createdAt: serverTimestamp() })`.
