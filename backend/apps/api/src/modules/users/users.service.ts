import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
// The database barrel also loads application configuration, including Redis.
import { User } from '../../../../../libs/database/src/entities';

export interface GoogleProfile {
  subject: string;
  email: string;
  name: string;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

export type PublicUser = ReturnType<typeof publicUser>;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async findById(id: string): Promise<PublicUser | null> {
    try {
      const user = await this.users.findOneBy({ id });
      return user ? publicUser(user) : null;
    } catch {
      throw new ServiceUnavailableException(
        'Account storage is temporarily unavailable',
      );
    }
  }

  async findOrCreateGoogleUser(profile: GoogleProfile): Promise<PublicUser> {
    try {
      // Google's stable subject identifies an account, never its mutable email.
      const existing = await this.users.findOneBy({
        googleSubject: profile.subject,
      });
      if (existing) return publicUser(existing);
      if (await this.users.existsBy({ email: profile.email })) {
        const concurrent = await this.users.findOneBy({
          googleSubject: profile.subject,
        });
        if (concurrent) return publicUser(concurrent);
        throw new ConflictException(
          'This email already belongs to another account. Account linking is required.',
        );
      }
      try {
        const user = await this.users.save(
          this.users.create({
            googleSubject: profile.subject,
            email: profile.email,
            displayName: profile.name,
            passwordHash: null,
          }),
        );
        return publicUser(user);
      } catch (error) {
        if (
          !(error instanceof QueryFailedError) ||
          error.driverError.code !== 'ER_DUP_ENTRY'
        )
          throw error;
        // A concurrent first login can win the unique-subject insert race.
        const winner = await this.users.findOneBy({
          googleSubject: profile.subject,
        });
        if (winner) return publicUser(winner);
        throw new ConflictException(
          'This email already belongs to another account. Account linking is required.',
        );
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException(
        'Account storage is temporarily unavailable',
      );
    }
  }
}
