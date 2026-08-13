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
            createUser: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'customer' }),
            updateRole: jest.fn().mockResolvedValue(undefined),
        };
        credentialRepo = {
            findByUserId: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({}),
            updateCounter: jest.fn().mockResolvedValue(undefined),
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

    describe('beginLogin', () => {
        it('unknown email → still returns options with an empty allow-list (no enumeration)', async () => {
            userRepo.findByEmail.mockResolvedValue(null);
            mockedWebauthn.buildAuthenticationOptions.mockResolvedValue({ challenge: 'CH' } as any);
            await service.beginLogin('nobody@x.com');
            expect(mockedWebauthn.buildAuthenticationOptions).toHaveBeenCalledWith({ allowCredentialIds: [] });
            expect(mockedChallenge.setChallenge).toHaveBeenCalledWith('webauthn:login:nobody@x.com', 'CH');
        });

        it('known email → allow-list from the account’s passkeys', async () => {
            userRepo.findByEmail.mockResolvedValue({ id: 'u1' });
            credentialRepo.findByUserId.mockResolvedValue([{ credentialId: 'c1' }]);
            mockedWebauthn.buildAuthenticationOptions.mockResolvedValue({ challenge: 'CH' } as any);
            await service.beginLogin('a@b.com');
            expect(mockedWebauthn.buildAuthenticationOptions).toHaveBeenCalledWith({ allowCredentialIds: ['c1'] });
        });
    });

    describe('finishLogin', () => {
        it('no pending challenge → UnauthorizedError', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue(null);
            await expect(service.finishLogin('a@b.com', {} as any)).rejects.toMatchObject({
                name: 'UnauthorizedError',
            });
        });

        it('credential not on the account → UnauthorizedError', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            userRepo.findByEmail.mockResolvedValue({ id: 'u1', role: 'customer' });
            credentialRepo.findByUserId.mockResolvedValue([{ credentialId: 'other' }]);
            await expect(service.finishLogin('a@b.com', { id: 'mine' } as any)).rejects.toMatchObject({
                name: 'UnauthorizedError',
            });
        });

        it('verifies the assertion, advances the counter, and mints a token', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            userRepo.findByEmail.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'customer' });
            credentialRepo.findByUserId.mockResolvedValue([
                { credentialId: 'mine', publicKey: 'pk', counter: 0, transports: ['internal'] },
            ]);
            mockedWebauthn.verifyAuthentication.mockResolvedValue({ newCounter: 5 } as any);
            mockedJwt.signAccessToken.mockReturnValue('login-token');
            const res = await service.finishLogin('a@b.com', { id: 'mine' } as any);
            expect(credentialRepo.updateCounter).toHaveBeenCalledWith('mine', 5);
            expect(mockedJwt.signAccessToken).toHaveBeenCalledWith({ sub: 'u1', role: 'customer' });
            expect(res.token).toBe('login-token');
        });

        it('failed assertion → UnauthorizedError (generic)', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            userRepo.findByEmail.mockResolvedValue({ id: 'u1', role: 'customer' });
            credentialRepo.findByUserId.mockResolvedValue([{ credentialId: 'mine', publicKey: 'pk', counter: 0 }]);
            mockedWebauthn.verifyAuthentication.mockRejectedValue(new Error('bad sig'));
            await expect(service.finishLogin('a@b.com', { id: 'mine' } as any)).rejects.toMatchObject({
                name: 'UnauthorizedError',
            });
        });
    });
});
