import { Repository, EntityManager } from 'typeorm';
import { User } from '../entities/User';
import { inject, injectable } from 'tsyringe';

export interface IUserRepository {
    findByEmail(email: string, manager?: EntityManager): Promise<User | null>;
    findById(id: string, manager?: EntityManager): Promise<User | null>;
    createUser(data: { email: string; role?: string }, manager?: EntityManager): Promise<User>;
}

@injectable()
export class UserRepository implements IUserRepository {
    constructor(@inject('UserTypeOrmRepo') private repo: Repository<User>) {}

    async findByEmail(email: string, manager?: EntityManager): Promise<User | null> {
        const repo = manager ? manager.getRepository(User) : this.repo;
        return repo.findOne({ where: { email } });
    }

    async findById(id: string, manager?: EntityManager): Promise<User | null> {
        const repo = manager ? manager.getRepository(User) : this.repo;
        return repo.findOne({ where: { id } });
    }

    async createUser(data: { email: string; role?: string }, manager?: EntityManager): Promise<User> {
        const repo = manager ? manager.getRepository(User) : this.repo;
        const user = repo.create({ email: data.email, role: data.role ?? 'customer' });
        return repo.save(user);
    }
}
