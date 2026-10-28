import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Store, StoreInvitation, StoreMember, User } from '@app/database';
import { AuthModule } from '../auth/auth.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

// Shop teams only add content authors; account-level controls stay with the
// owner and are never exposed here.
@Module({
  imports: [
    TypeOrmModule.forFeature([Store, StoreMember, StoreInvitation, User]),
    AuthModule,
  ],
  controllers: [TeamController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
