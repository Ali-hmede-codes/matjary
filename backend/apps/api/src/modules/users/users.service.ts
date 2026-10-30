import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
// The database barrel also loads application configuration, including Redis.
import {
  AdminScope,
  User,
  UserRole,
} from '../../../../../libs/database/src/entities';

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
    role: user.role ?? UserRole.USER,
    // The panel trims its navigation for a store-scoped administrator; the
    // server still re-reads the database on every privileged request.
    adminScope: user.adminScope ?? AdminScope.ALL,
    createdAt: user.createdAt,
  };
}

export type PublicUser = ReturnType<typeof publicUser>;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async findSessionAccount(
    id: string,
  ): Promise<{ user: PublicUser; version: number } | null> {
    try {
      const account = await this.users.findOneBy({ id });
      if (!account || account.suspendedAt) return null;
      return { user: publicUser(account), version: account.sessionVersion };
    } catch {
      throw new ServiceUnavailableException(
        'Account storage is temporarily unavailable',
      );
    }
  }

  private activeUser(account: User): PublicUser {
    if (account.suspendedAt)
      throw new UnauthorizedException('Account access is unavailable');
    return publicUser(account);
  }

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
      if (existing) return this.activeUser(existing);
      if (await this.users.existsBy({ email: profile.email })) {
        const concurrent = await this.users.findOneBy({
          googleSubject: profile.subject,
        });
        if (concurrent) return this.activeUser(concurrent);
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
        if (winner) return this.activeUser(winner);
        throw new ConflictException(
          'This email already belongs to another account. Account linking is required.',
        );
      }
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof UnauthorizedException
      )
        throw error;
      throw new ServiceUnavailableException(
        'Account storage is temporarily unavailable',
      );
    }
  }
}
