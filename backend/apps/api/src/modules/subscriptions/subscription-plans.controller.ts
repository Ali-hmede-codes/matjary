import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';
import {
  SessionGuard,
  AdminGuard,
  MutationGuard,
  AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';

@Controller('admin/subscriptions/plans')
@UseGuards(SessionGuard, AdminGuard, MutationGuard)
export class SubscriptionPlansController {
  constructor(private readonly plans: SubscriptionPlansService) {}

  @Post('assign')
  async assign(
    @Body() dto: AssignSubscriptionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.plans.assignSubscription(
      dto.userId,
      dto.planId,
      request.user.id,
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      dto.notes,
    );
  }

  @Post()
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSubscriptionPlanDto,
    @Req() request: AuthenticatedRequest,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.plans.create(dto, request.user.id);
  }

  @Get()
  @UseGuards(SessionGuard)
  async findAll(
    @Query('includeInactive') includeInactive?: string,
  ): Promise<SubscriptionPlanResponseDto[]> {
    return this.plans.findAll(includeInactive === 'true');
  }

  @Get(':slug')
  @UseGuards(SessionGuard)
  async findBySlug(
    @Param('slug') slug: string,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.plans.findBySlug(slug);
  }

  @Get('id/:id')
  @UseGuards(SessionGuard)
  async findById(
    @Param('id') id: string,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.plans.findById(id);
  }

  @Patch(':id')
  @UseGuards(SessionGuard)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.plans.update(id, dto, request.user.id);
  }

  @Delete(':id')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.plans.delete(id, request.user.id);
  }
}
