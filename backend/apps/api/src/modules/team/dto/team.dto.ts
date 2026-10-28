import { IsEmail, IsString, MaxLength } from 'class-validator';

export class InviteTeamMemberDto {
  // A plain Gmail address; the account signs in with Google later.
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class TeamMemberDto {
  id!: string;
  userId!: string;
  displayName!: string;
  email!: string;
  role!: string;
  joinedAt!: Date;
}

export class TeamInvitationDto {
  id!: string;
  email!: string;
  createdAt!: Date;
  expiresAt!: Date;
}

export class TeamResponseDto {
  storeId!: string;
  members!: TeamMemberDto[];
  invitations!: TeamInvitationDto[];
  maxMembers!: number;
}

export class TeamInviteResultDto {
  // "added" means the Gmail account already existed and has access now;
  // "invited" means the address must sign in and accept first.
  status!: 'added' | 'invited';
  member?: TeamMemberDto;
  invitation?: TeamInvitationDto;
}

export class MyTeamInvitationDto {
  id!: string;
  store!: {
    id: string;
    name: string;
    slug: string;
    logoKey: string | null;
  };
  invitedByName!: string;
  expiresAt!: Date;
}

export class AcceptedTeamInvitationDto {
  store!: MyTeamInvitationDto['store'];
}
