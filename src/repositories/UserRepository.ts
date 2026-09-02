import { Repository, EntityManager } from 'typeorm';
import { User } from '../entities/User';
import { UserRole } from '../auth/roles';
import { inject, injectable } from 'tsyringe';

export interface IUserRepository {
    findByEmail(email: string, manager?: EntityManager): Promise<User | null>;
    findById(id: string, manager?: EntityManager): Promise<User | null>;
    createUser(data: { email: string; role?: UserRole }, manager?: EntityManager): Promise<User>;
    updateRole(userId: string, role: UserRole, manager?: EntityManager): Promise<void>;
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

    async createUser(data: { email: string; role?: UserRole }, manager?: EntityManager): Promise<User> {
        const repo = manager ? manager.getRepository(User) : this.repo;
        const user = repo.create({ email: data.email, role: data.role ?? UserRole.CUSTOMER });
        return repo.save(user);
    }

    async updateRole(userId: string, role: UserRole, manager?: EntityManager): Promise<void> {
        const repo = manager ? manager.getRepository(User) : this.repo;
        await repo.update({ id: userId }, { role });
    }
}
