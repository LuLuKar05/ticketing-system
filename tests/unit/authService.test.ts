import { AuthService } from '../../src/services/AuthService';
import * as webauthn from '../../src/auth/webauthn';
import * as challengeStore from '../../src/auth/challengeStore';
import * as jwtUtil from '../../src/auth/jwt';

// The WebAuthn ceremony + RS256 signing are exercised by their own integration; here we mock them
// to unit-test the service's orchestration (challenge lifecycle, find-or-create, token issue).
jest.mock('../../src/auth/webauthn');
jest.mock('../../src/auth/challengeStore');
jest.mock('../../src/auth/jwt');

const mockedWebauthn = webauthn as jest.Mocked<typeof webauthn>;
const mockedChallenge = challengeStore as jest.Mocked<typeof challengeStore>;
const mockedJwt = jwtUtil as jest.Mocked<typeof jwtUtil>;

describe('AuthService (unit, mocked webauthn/jwt)', () => {
    let userRepo: any;
    let credentialRepo: any;
    let service: AuthService;

    const verified = {
        credentialId: 'cred1',
        publicKey: 'pk',
        counter: 0,
        transports: ['internal'],
        deviceType: 'multiDevice',
        backedUp: true,
        aaguid: 'aa',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.ADMIN_EMAILS; // default: nobody is admin
        userRepo = {
            findByEmail: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'customer' }),
            createUser: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'customer' }),
            updateRole: jest.fn().mockResolvedValue(undefined),
        };
        credentialRepo = {
            findByUserId: jest.fn().mockResolvedValue([]),
            findByCredentialId: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
            updateCounter: jest.fn().mockResolvedValue(undefined),
            deleteByIdForUser: jest.fn().mockResolvedValue(1),
        };
        service = new AuthService(userRepo, credentialRepo);
    });

    describe('beginRegistration', () => {
        it('issues options and stores the challenge under the normalized email', async () => {
            mockedWebauthn.buildRegistrationOptions.mockResolvedValue({ challenge: 'CH' } as any);
            const options = await service.beginRegistration('A@B.com');
            expect(options.challenge).toBe('CH');
            expect(mockedWebauthn.buildRegistrationOptions).toHaveBeenCalledWith({
                email: 'a@b.com',
                excludeCredentialIds: [],
            });
            expect(mockedChallenge.setChallenge).toHaveBeenCalledWith('webauthn:reg:a@b.com', 'CH');
        });

        it('excludes an existing account’s passkeys', async () => {
            userRepo.findByEmail.mockResolvedValue({ id: 'u1' });
            credentialRepo.findByUserId.mockResolvedValue([{ credentialId: 'c1' }, { credentialId: 'c2' }]);
            mockedWebauthn.buildRegistrationOptions.mockResolvedValue({ challenge: 'CH' } as any);
            await service.beginRegistration('a@b.com');
            expect(mockedWebauthn.buildRegistrationOptions).toHaveBeenCalledWith({
                email: 'a@b.com',
                excludeCredentialIds: ['c1', 'c2'],
            });
        });
    });

    describe('finishRegistration', () => {
        it('no pending challenge → BadRequestError', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue(null);
            await expect(service.finishRegistration('a@b.com', {} as any)).rejects.toMatchObject({
                name: 'BadRequestError',
            });
        });

        it('failed attestation → BadRequestError', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            mockedWebauthn.verifyRegistration.mockRejectedValue(new Error('bad'));
            await expect(service.finishRegistration('a@b.com', {} as any)).rejects.toMatchObject({
                name: 'BadRequestError',
            });
        });

        it('verifies, creates the account + credential, and mints a token', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            mockedWebauthn.verifyRegistration.mockResolvedValue(verified as any);
            mockedJwt.signAccessToken.mockReturnValue('jwt-token');
            const res = await service.finishRegistration('A@B.com', { id: 'x' } as any);
            expect(mockedWebauthn.verifyRegistration).toHaveBeenCalledWith({
                response: { id: 'x' },
                expectedChallenge: 'CH',
            });
            expect(userRepo.createUser).toHaveBeenCalledWith({ email: 'a@b.com', role: 'customer' });
            expect(credentialRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 'u1', credentialId: 'cred1', publicKey: 'pk' }),
            );
            expect(mockedJwt.signAccessToken).toHaveBeenCalledWith({ sub: 'u1', role: 'customer' });
            expect(res.token).toBe('jwt-token');
        });

        it('reuses an existing account and re-resolves its role from the allowlist', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            mockedWebauthn.verifyRegistration.mockResolvedValue(verified as any);
            // was admin, but the email is no longer in ADMIN_EMAILS → demote on this ceremony
            userRepo.findByEmail.mockResolvedValue({ id: 'existing', email: 'a@b.com', role: 'admin' });
            mockedJwt.signAccessToken.mockReturnValue('t');
            await service.finishRegistration('a@b.com', {} as any);
            expect(userRepo.createUser).not.toHaveBeenCalled();
            expect(userRepo.updateRole).toHaveBeenCalledWith('existing', 'customer');
            expect(mockedJwt.signAccessToken).toHaveBeenCalledWith({ sub: 'existing', role: 'customer' });
        });

        it('an ADMIN_EMAILS email registers as admin (role in the token)', async () => {
            process.env.ADMIN_EMAILS = 'boss@x.com';
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            mockedWebauthn.verifyRegistration.mockResolvedValue(verified as any);
            userRepo.createUser.mockResolvedValue({ id: 'u9', email: 'boss@x.com', role: 'admin' });
            mockedJwt.signAccessToken.mockReturnValue('admin-token');
            await service.finishRegistration('boss@x.com', {} as any);
            expect(userRepo.createUser).toHaveBeenCalledWith({ email: 'boss@x.com', role: 'admin' });
            expect(mockedJwt.signAccessToken).toHaveBeenCalledWith({ sub: 'u9', role: 'admin' });
        });
    });

    describe('beginLogin (unified: email optional / usernameless)', () => {
        it('with a known email → allow-list from the account’s passkeys, challenge stored under a loginId', async () => {
            userRepo.findByEmail.mockResolvedValue({ id: 'u1' });
            credentialRepo.findByUserId.mockResolvedValue([{ credentialId: 'c1' }]);
            mockedWebauthn.buildAuthenticationOptions.mockResolvedValue({ challenge: 'CH' } as any);
            const res = await service.beginLogin('a@b.com');
            expect(mockedWebauthn.buildAuthenticationOptions).toHaveBeenCalledWith({ allowCredentialIds: ['c1'] });
            expect(mockedChallenge.setChallenge).toHaveBeenCalledWith(expect.stringMatching(/^webauthn:login:/), 'CH');
            expect(typeof res.loginId).toBe('string');
        });

        it('with NO email → usernameless: empty allow-list (discoverable / conditional UI)', async () => {
            mockedWebauthn.buildAuthenticationOptions.mockResolvedValue({ challenge: 'CH' } as any);
            await service.beginLogin();
            expect(userRepo.findByEmail).not.toHaveBeenCalled();
            expect(mockedWebauthn.buildAuthenticationOptions).toHaveBeenCalledWith({ allowCredentialIds: [] });
        });

        it('an unknown email is indistinguishable from usernameless (empty allow-list, no enumeration)', async () => {
            userRepo.findByEmail.mockResolvedValue(null);
            mockedWebauthn.buildAuthenticationOptions.mockResolvedValue({ challenge: 'CH' } as any);
            await service.beginLogin('nobody@x.com');
            expect(mockedWebauthn.buildAuthenticationOptions).toHaveBeenCalledWith({ allowCredentialIds: [] });
        });
    });

    describe('finishLogin (resolves the user from the passkey)', () => {
        it('no pending challenge → UnauthorizedError', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue(null);
            await expect(service.finishLogin('login1', {} as any)).rejects.toMatchObject({ name: 'UnauthorizedError' });
        });

        it('unknown credential → UnauthorizedError', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            credentialRepo.findByCredentialId.mockResolvedValue(null);
            await expect(service.finishLogin('login1', { id: 'ghost' } as any)).rejects.toMatchObject({
                name: 'UnauthorizedError',
            });
        });

        it('verifies the assertion, advances the counter, mints tokens (user from credential)', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            credentialRepo.findByCredentialId.mockResolvedValue({
                credentialId: 'mine',
                publicKey: 'pk',
                counter: 0,
                transports: ['internal'],
                user: { id: 'u1', email: 'a@b.com', role: 'customer' },
            });
            mockedWebauthn.verifyAuthentication.mockResolvedValue({ newCounter: 5 } as any);
            mockedJwt.signAccessToken.mockReturnValue('login-token');
            const res = await service.finishLogin('login1', { id: 'mine' } as any);
            expect(credentialRepo.updateCounter).toHaveBeenCalledWith('mine', 5);
            expect(mockedJwt.signAccessToken).toHaveBeenCalledWith({ sub: 'u1', role: 'customer' });
            expect(res.token).toBe('login-token');
        });

        it('failed assertion → UnauthorizedError (generic)', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            credentialRepo.findByCredentialId.mockResolvedValue({
                credentialId: 'mine',
                publicKey: 'pk',
                counter: 0,
                user: { id: 'u1', email: 'a@b.com', role: 'customer' },
            });
            mockedWebauthn.verifyAuthentication.mockRejectedValue(new Error('bad sig'));
            await expect(service.finishLogin('login1', { id: 'mine' } as any)).rejects.toMatchObject({
                name: 'UnauthorizedError',
            });
        });
    });

    describe('multi-device passkeys (A3b)', () => {
        it('beginAddCredential: options + challenge keyed by user id, excludes existing', async () => {
            userRepo.findById.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
            credentialRepo.findByUserId.mockResolvedValue([{ credentialId: 'c1' }]);
            mockedWebauthn.buildRegistrationOptions.mockResolvedValue({ challenge: 'CH' } as any);
            await service.beginAddCredential('u1');
            expect(mockedWebauthn.buildRegistrationOptions).toHaveBeenCalledWith({
                email: 'a@b.com',
                excludeCredentialIds: ['c1'],
            });
            expect(mockedChallenge.setChallenge).toHaveBeenCalledWith('webauthn:addcred:u1', 'CH');
        });

        it('beginAddCredential: unknown user → NotFoundError', async () => {
            userRepo.findById.mockResolvedValue(null);
            await expect(service.beginAddCredential('ghost')).rejects.toMatchObject({ name: 'NotFoundError' });
        });

        it('finishAddCredential: verifies + attaches the passkey (with nickname)', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            mockedWebauthn.verifyRegistration.mockResolvedValue(verified as any);
            credentialRepo.create.mockResolvedValue({ id: 'cred-row' });
            const res = await service.finishAddCredential('u1', {} as any, 'My phone');
            expect(credentialRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 'u1', credentialId: 'cred1', nickname: 'My phone' }),
            );
            expect(res).toEqual({ id: 'cred-row' });
        });

        it('finishAddCredential: no pending challenge → BadRequestError', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue(null);
            await expect(service.finishAddCredential('u1', {} as any)).rejects.toMatchObject({
                name: 'BadRequestError',
            });
        });

        it('removeCredential: refuses to delete the only passkey → ConflictError', async () => {
            credentialRepo.findByUserId.mockResolvedValue([{ id: 'only' }]);
            await expect(service.removeCredential('u1', 'only')).rejects.toMatchObject({ name: 'ConflictError' });
            expect(credentialRepo.deleteByIdForUser).not.toHaveBeenCalled();
        });

        it('removeCredential: deletes when more than one exists', async () => {
            credentialRepo.findByUserId.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
            credentialRepo.deleteByIdForUser.mockResolvedValue(1);
            await service.removeCredential('u1', 'a');
            expect(credentialRepo.deleteByIdForUser).toHaveBeenCalledWith('a', 'u1');
        });

        it('removeCredential: not the caller’s credential (0 affected) → NotFoundError', async () => {
            credentialRepo.findByUserId.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
            credentialRepo.deleteByIdForUser.mockResolvedValue(0);
            await expect(service.removeCredential('u1', 'not-mine')).rejects.toMatchObject({ name: 'NotFoundError' });
        });
    });
});
