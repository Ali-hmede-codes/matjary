import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, type EntityManager, type Repository } from 'typeorm';
import {
  Store,
  StoreInvitation,
  StoreMember,
  StoreMemberRole,
  User,
  invitationIsLive,
  ownerVisibilitySql,
  ownerWhere,
} from '@app/database';
import {
  AcceptedTeamInvitationDto,
  MyTeamInvitationDto,
  TeamInvitationDto,
  TeamInviteResultDto,
  TeamMemberDto,
  TeamResponseDto,
} from './dto/team.dto';

// A shop team is intentionally small: enough for a family or a small crew,
// while keeping every response and the owner's plan usage bounded.
const MAX_TEAM_MEMBERS = 10;
const INVITATION_TTL_DAYS = 7;
const LIVE_INVITATION_LIMIT = 20;

export function normalizeTeamEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(StoreMember)
    private readonly members: Repository<StoreMember>,
    @InjectRepository(StoreInvitation)
    private readonly invitations: Repository<StoreInvitation>,
  ) {}

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Team access is temporarily unavailable',
    );
  }

  private expiry(): Date {
    return new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  private assertRoom(members: number, pending: number): void {
    if (members + pending >= MAX_TEAM_MEMBERS)
      throw new ConflictException({
        code: 'TEAM_LIMIT',
        message:
          'This shop has reached its team limit. Remove someone before adding another.',
      });
  }

  // Only the shop owner manages the team; members get the same "not found"
  // answer as any other visitor.
  private async ownedStore(
    manager: EntityManager,
    slug: string,
    ownerId: string,
    lock = false,
  ): Promise<Store> {
    const store = await manager.findOne(Store, {
      where: { slug, ownerId, ...ownerWhere('store') },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private memberDto(
    member: StoreMember,
    user: Pick<User, 'id' | 'displayName' | 'email'>,
  ): TeamMemberDto {
    return {
      id: member.id,
      userId: member.userId,
      displayName: user.displayName,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    };
  }

  private invitationDto(invitation: StoreInvitation): TeamInvitationDto {
    return {
      id: invitation.id,
      email: invitation.email,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    };
  }

  async list(slug: string, ownerId: string): Promise<TeamResponseDto> {
    try {
      const store = await this.ownedStore(this.stores.manager, slug, ownerId);
      const now = new Date();
      const [members, invitations] = await Promise.all([
        this.members.find({
          where: { storeId: store.id },
          relations: { user: true },
          order: { createdAt: 'ASC' },
        }),
        this.invitations.find({
          where: { storeId: store.id, expiresAt: MoreThan(now) },
          order: { createdAt: 'DESC' },
        }),
      ]);
      return {
        storeId: store.id,
        members: members.map((member) => this.memberDto(member, member.user)),
        invitations: invitations.map((invitation) =>
          this.invitationDto(invitation),
        ),
        maxMembers: MAX_TEAM_MEMBERS,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * One form for both paths: an existing Google account gets access right
   * away, while a new Gmail address receives a pending invitation.
   */
  async invite(
    slug: string,
    email: string,
    actor: { id: string; email: string },
  ): Promise<TeamInviteResultDto> {
    const normalized = normalizeTeamEmail(email);
    try {
      return await this.stores.manager.transaction(async (manager) => {
        const store = await this.ownedStore(manager, slug, actor.id, true);
        if (normalized === normalizeTeamEmail(actor.email))
          throw new ConflictException({
            code: 'TEAM_OWN_EMAIL',
            message: 'You already own this shop',
          });

        // Expired rows are removed before counting, so a stale invitation can
        // never consume a team slot forever.
        const pending = await manager.find(StoreInvitation, {
          where: { storeId: store.id },
        });
        const expired = pending.filter(
          (invitation) => !invitationIsLive(invitation),
        );
        if (expired.length)
          await manager.delete(StoreInvitation, {
            id: In(expired.map((invitation) => invitation.id)),
          });
        const livePending = pending.filter((invitation) =>
          invitationIsLive(invitation),
        );
        const memberCount = await manager.countBy(StoreMember, {
          storeId: store.id,
        });

        const account = await manager.findOne(User, {
          where: { email: normalized },
        });
        if (account) {
          if (account.suspendedAt)
            throw new ConflictException({
              code: 'TEAM_ACCOUNT_UNAVAILABLE',
              message: 'This account cannot be added',
            });
          const existing = await manager.findOneBy(StoreMember, {
            storeId: store.id,
            userId: account.id,
          });
          if (existing)
            throw new ConflictException({
              code: 'TEAM_ALREADY_MEMBER',
              message: 'This person already has access',
            });
          // A pending invite for the same address is superseded by direct
          // access; it must not keep a slot or linger in the invitee's panel.
          const superseded = livePending.filter(
            (invitation) => invitation.email === normalized,
          );
          this.assertRoom(memberCount, livePending.length - superseded.length);
          if (superseded.length)
            await manager.delete(StoreInvitation, {
              id: In(superseded.map((invitation) => invitation.id)),
            });
          const saved = await manager.save(
            manager.create(StoreMember, {
              storeId: store.id,
              userId: account.id,
              role: StoreMemberRole.EDITOR,
            }),
          );
          return {
            status: 'added' as const,
            member: this.memberDto(saved, account),
          };
        }

        const pendingForEmail = livePending.find(
          (invitation) => invitation.email === normalized,
        );
        if (pendingForEmail) {
          pendingForEmail.expiresAt = this.expiry();
          pendingForEmail.invitedById = actor.id;
          return {
            status: 'invited' as const,
            invitation: this.invitationDto(await manager.save(pendingForEmail)),
          };
        }
        this.assertRoom(memberCount, livePending.length);
        const invitation = await manager.save(
          manager.create(StoreInvitation, {
            storeId: store.id,
            email: normalized,
            invitedById: actor.id,
            expiresAt: this.expiry(),
          }),
        );
        return {
          status: 'invited' as const,
          invitation: this.invitationDto(invitation),
        };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async removeMember(
    slug: string,
    memberId: string,
    ownerId: string,
  ): Promise<void> {
    try {
      await this.stores.manager.transaction(async (manager) => {
        const store = await this.ownedStore(manager, slug, ownerId, true);
        const member = await manager.findOneBy(StoreMember, {
          id: memberId,
          storeId: store.id,
        });
        if (!member) throw new NotFoundException('Team member not found');
        await manager.remove(member);
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async cancelInvitation(
    slug: string,
    invitationId: string,
    ownerId: string,
  ): Promise<void> {
    try {
      await this.stores.manager.transaction(async (manager) => {
        const store = await this.ownedStore(manager, slug, ownerId, true);
        const invitation = await manager.findOneBy(StoreInvitation, {
          id: invitationId,
          storeId: store.id,
        });
        if (!invitation) throw new NotFoundException('Invitation not found');
        await manager.remove(invitation);
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  /** Pending invitations addressed to the signed-in Google account. */
  async mine(user: {
    id: string;
    email: string;
  }): Promise<MyTeamInvitationDto[]> {
    try {
      const email = normalizeTeamEmail(user.email);
      const rows = await this.invitations
        .createQueryBuilder('invitation')
        .innerJoinAndSelect('invitation.store', 'store')
        .innerJoinAndSelect('invitation.invitedBy', 'invitedBy')
        .where('invitation.email = :email', { email })
        .andWhere('invitation.expiresAt > :now', { now: new Date() })
        .andWhere(ownerVisibilitySql('store', 'store'))
        .orderBy('invitation.createdAt', 'DESC')
        .take(LIVE_INVITATION_LIMIT)
        .getMany();
      return rows.map((invitation) => ({
        id: invitation.id,
        store: {
          id: invitation.store.id,
          name: invitation.store.name,
          slug: invitation.store.slug,
          logoKey: invitation.store.logoKey,
        },
        invitedByName: invitation.invitedBy.displayName,
        expiresAt: invitation.expiresAt,
      }));
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Accepting is bound to the Google email that was invited. The account's
   * email comes from the verified Google credential, so the invitation cannot
   * be claimed from another account.
   */
  async accept(
    invitationId: string,
    user: { id: string; email: string },
  ): Promise<AcceptedTeamInvitationDto> {
    const email = normalizeTeamEmail(user.email);
    try {
      return await this.invitations.manager.transaction(async (manager) => {
        const invitation = await manager.findOne(StoreInvitation, {
          where: { id: invitationId },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !invitation ||
          invitation.email !== email ||
          !invitationIsLive(invitation)
        )
          throw new NotFoundException('Invitation not found');
        const store = await manager.findOneBy(Store, {
          id: invitation.storeId,
          ...ownerWhere('store'),
        });
        if (!store) throw new NotFoundException('Invitation not found');
        const existing = await manager.findOneBy(StoreMember, {
          storeId: store.id,
          userId: user.id,
        });
        if (!existing) {
          const memberCount = await manager.countBy(StoreMember, {
            storeId: store.id,
          });
          this.assertRoom(memberCount, 0);
          await manager.save(
            manager.create(StoreMember, {
              storeId: store.id,
              userId: user.id,
              role: StoreMemberRole.EDITOR,
            }),
          );
        }
        await manager.remove(invitation);
        return {
          store: {
            id: store.id,
            name: store.name,
            slug: store.slug,
            logoKey: store.logoKey,
          },
        };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async decline(
    invitationId: string,
    user: { id: string; email: string },
  ): Promise<void> {
    const email = normalizeTeamEmail(user.email);
    try {
      await this.invitations.manager.transaction(async (manager) => {
        const invitation = await manager.findOne(StoreInvitation, {
          where: { id: invitationId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!invitation || invitation.email !== email)
          throw new NotFoundException('Invitation not found');
        await manager.remove(invitation);
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  /** A member can leave a shop at any time; ownership is never removed here. */
  async leave(storeId: string, userId: string): Promise<void> {
    try {
      const member = await this.members.findOneBy({ storeId, userId });
      if (!member) throw new ForbiddenException('Team membership not found');
      await this.members.remove(member);
    } catch (error) {
      this.sanitize(error);
    }
  }
}
