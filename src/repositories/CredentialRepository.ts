import { Repository, EntityManager } from 'typeorm';
import { Credential } from '../entities/Credential';
import { User } from '../entities/User';
import { inject, injectable } from 'tsyringe';

export interface ICreateCredentialParams {
    userId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: string[];
    deviceType: string;
    backedUp: boolean;
    aaguid: string;
}

export interface ICredentialRepository {
    create(params: ICreateCredentialParams, manager?: EntityManager): Promise<Credential>;
    findByCredentialId(credentialId: string, manager?: EntityManager): Promise<Credential | null>;
    findByUserId(userId: string, manager?: EntityManager): Promise<Credential[]>;
    /** Persist the advanced sign counter after a successful assertion (clone detection, A2). */
    updateCounter(credentialId: string, counter: number, manager?: EntityManager): Promise<void>;
}

@injectable()
export class CredentialRepository implements ICredentialRepository {
    constructor(@inject('CredentialTypeOrmRepo') private repo: Repository<Credential>) {}

    async create(params: ICreateCredentialParams, manager?: EntityManager): Promise<Credential> {
        const repo = manager ? manager.getRepository(Credential) : this.repo;
        const credential = repo.create({
            user: { id: params.userId } as User, // partial relation — TypeORM only needs the FK id
            credentialId: params.credentialId,
            publicKey: params.publicKey,
            counter: params.counter,
            transports: params.transports,
            deviceType: params.deviceType,
            backedUp: params.backedUp,
            aaguid: params.aaguid,
            lastUsedAt: new Date(),
        });
        return repo.save(credential);
    }

    async findByCredentialId(credentialId: string, manager?: EntityManager): Promise<Credential | null> {
        const repo = manager ? manager.getRepository(Credential) : this.repo;
        return repo.findOne({ where: { credentialId } });
    }

    async findByUserId(userId: string, manager?: EntityManager): Promise<Credential[]> {
        const repo = manager ? manager.getRepository(Credential) : this.repo;
        return repo.find({ where: { user: { id: userId } } });
    }

    async updateCounter(credentialId: string, counter: number, manager?: EntityManager): Promise<void> {
        const repo = manager ? manager.getRepository(Credential) : this.repo;
        await repo.update({ credentialId }, { counter, lastUsedAt: new Date() });
    }
}
