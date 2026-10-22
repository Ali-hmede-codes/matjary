import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';
import { SessionGuard, AuthenticatedRequest } from '../auth/guards/auth.guards';

@Controller('admin/subscriptions/plans')
export class SubscriptionPlansController {
  constructor(private readonly plans: SubscriptionPlansService) {}

  @Post()
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSubscriptionPlanDto,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.plans.create(dto);
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
  ): Promise<SubscriptionPlanResponseDto> {
    return this.plans.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    return this.plans.delete(id);
  }
}
