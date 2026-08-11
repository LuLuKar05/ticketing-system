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
        userRepo = {
            findByEmail: jest.fn().mockResolvedValue(null),
            createUser: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'customer' }),
        };
        credentialRepo = { findByUserId: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) };
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
            expect(userRepo.createUser).toHaveBeenCalledWith({ email: 'a@b.com' });
            expect(credentialRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 'u1', credentialId: 'cred1', publicKey: 'pk' }),
            );
            expect(mockedJwt.signAccessToken).toHaveBeenCalledWith({ sub: 'u1', role: 'customer' });
            expect(res.token).toBe('jwt-token');
        });

        it('attaches the passkey to an existing account instead of creating a duplicate', async () => {
            mockedChallenge.takeChallenge.mockResolvedValue('CH');
            mockedWebauthn.verifyRegistration.mockResolvedValue(verified as any);
            userRepo.findByEmail.mockResolvedValue({ id: 'existing', email: 'a@b.com', role: 'admin' });
            mockedJwt.signAccessToken.mockReturnValue('t');
            await service.finishRegistration('a@b.com', {} as any);
            expect(userRepo.createUser).not.toHaveBeenCalled();
            expect(mockedJwt.signAccessToken).toHaveBeenCalledWith({ sub: 'existing', role: 'admin' });
        });
    });
});
