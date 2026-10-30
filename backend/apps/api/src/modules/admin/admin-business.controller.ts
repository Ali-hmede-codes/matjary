import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { BoostBidStrategy, adminContext, type AdminActor } from '@app/database';
import {
  SessionGuard,
  AdminGuard,
  MutationGuard,
} from '../auth/guards/auth.guards';
import { Actor } from './admin-context.interceptor';
import { AdminAccessService } from './admin-access.service';
import {
  AdminCampaignActionDto,
  AdminCreateCampaignDto,
  AdminReasonDto,
} from './admin.dto';
import { SubscriptionPlansService } from '../subscriptions/subscription-plans.service';
import { CreateSubscriptionPlanDto } from '../subscriptions/dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from '../subscriptions/dto/update-subscription-plan.dto';
import { AssignSubscriptionDto } from '../subscriptions/dto/assign-subscription.dto';
import { BoostService } from '../boost/boost.service';
import {
  AdminAdjustBalanceDto,
  UpdateBoostCampaignDto,
  UpdateBoostSettingsDto,
} from '../boost/dto/boost-coin.dto';
import { SeoService } from '../seo/seo.service';
import {
  SeoSettingsDto,
  StoreSeoDto,
  ProductSeoDto,
  ShowcaseSeoDto,
  CreateRedirectDto,
  UpdateRedirectDto,
  IndexNowDto,
} from '../seo/seo.dto';

const SEO_KINDS = {
  store: 'store',
  product: 'product',
  showcase: 'showcase',
} as const;

@Controller('admin')
@UseGuards(SessionGuard, AdminGuard, MutationGuard)
export class AdminBusinessController {
  constructor(
    private readonly access: AdminAccessService,
    private readonly plans: SubscriptionPlansService,
    private readonly boost: BoostService,
    private readonly seo: SeoService,
  ) {}

  @Post('plans')
  createPlan(
    @Body() dto: CreateSubscriptionPlanDto,
    @Actor() actor: AdminActor,
  ) {
    return this.plans.create(dto, actor.id);
  }

  @Patch('plans/:id')
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
    @Actor() actor: AdminActor,
  ) {
    return this.plans.update(id, dto, actor.id);
  }

  @Post('plans/:id/deactivate')
  deactivatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return adminContext.run(this.access.reason(actor, dto.reason), () =>
      this.plans.delete(id, actor.id),
    );
  }

  @Post('subscriptions/assign')
  assign(@Body() dto: AssignSubscriptionDto, @Actor() actor: AdminActor) {
    return this.plans.assignSubscription({
      userId: dto.userId,
      planId: dto.planId,
      assignedBy: actor.id,
      phone: dto.phone,
      phoneCountryCode: dto.phoneCountryCode,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      notes: dto.notes,
    });
  }

  @Post('subscriptions/:id/cancel')
  cancelSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return adminContext.run(this.access.reason(actor, dto.reason), () =>
      this.plans.cancelAssignment(id, actor.id),
    );
  }

  @Get('boost/settings')
  async boostSettings(@Actor() actor: AdminActor) {
    await this.access.check(actor);
    const settings = await this.boost.getSettings();
    return Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_match, letter: string) =>
          letter.toUpperCase(),
        ),
        value,
      ]),
    );
  }

  @Patch('boost/settings')
  async updateBoostSettings(
    @Body() dto: UpdateBoostSettingsDto,
    @Actor() actor: AdminActor,
  ) {
    await this.boost.updateSettings({ ...dto }, actor.id);
    return { success: true };
  }

  @Post('wallets/adjust')
  async adjustBalance(
    @Body() dto: AdminAdjustBalanceDto,
    @Actor() actor: AdminActor,
  ) {
    const result = await this.boost.adminAdjustBalance(
      actor.id,
      dto.userId,
      dto.amount,
      dto.description,
      dto.operationId,
    );
    return {
      newBalance: result.newBalance,
      transactionId: result.transaction.id,
    };
  }

  @Post('campaigns')
  createCampaign(
    @Body() dto: AdminCreateCampaignDto,
    @Actor() actor: AdminActor,
  ) {
    const { ownerId, ...campaign } = dto;
    return this.boost.asAdministrator(actor, () =>
      this.boost.createCampaign(ownerId, {
        ...campaign,
        bidStrategy: dto.bidStrategy ?? BoostBidStrategy.AUTO,
      }),
    );
  }

  @Patch('campaigns/:id')
  updateCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBoostCampaignDto,
    @Actor() actor: AdminActor,
  ) {
    return this.boost.asAdministrator(actor, async () => {
      const campaign = await this.boost.getCampaign(id);
      return this.boost.updateCampaign(id, campaign.userId, dto);
    });
  }

  @Post('campaigns/:id/action')
  campaignAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCampaignActionDto,
    @Actor() actor: AdminActor,
  ) {
    return this.boost.asAdministrator(
      this.access.reason(actor, dto.reason),
      async () => {
        const campaign = await this.boost.getCampaign(id);
        if (dto.action === 'pause')
          return this.boost.pauseCampaign(id, campaign.userId);
        if (dto.action === 'resume')
          return this.boost.resumeCampaign(id, campaign.userId);
        if (dto.action === 'cancel')
          return this.boost.cancelCampaign(id, campaign.userId);
        return this.boost.adminReviewCampaign(
          id,
          actor.id,
          dto.action,
          dto.reason,
        );
      },
    );
  }

  @Get('seo/settings')
  seoSettings(@Actor() actor: AdminActor) {
    return this.seo.getAdminSettings(actor.id);
  }

  @Put('seo/settings')
  updateSeoSettings(@Body() dto: SeoSettingsDto, @Actor() actor: AdminActor) {
    return this.seo.updateSettings(dto, actor.id);
  }

  @Get('seo/:kind/:id')
  getSeo(
    @Param('kind', new ParseEnumPipe(SEO_KINDS)) kind: keyof typeof SEO_KINDS,
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: AdminActor,
  ) {
    return this.seo.getAdminEntitySeo(kind, id, actor.id);
  }

  @Put('seo/store/:id')
  storeSeo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StoreSeoDto,
    @Actor() actor: AdminActor,
  ) {
    return this.seo.upsertAdminSeo('store', id, dto, actor);
  }

  @Put('seo/product/:id')
  productSeo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProductSeoDto,
    @Actor() actor: AdminActor,
  ) {
    return this.seo.upsertAdminSeo('product', id, dto, actor);
  }

  @Put('seo/showcase/:id')
  postSeo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShowcaseSeoDto,
    @Actor() actor: AdminActor,
  ) {
    return this.seo.upsertAdminSeo('showcase', id, dto, actor);
  }

  @Post('seo/:kind/:id/generate')
  generateSeo(
    @Param('kind', new ParseEnumPipe(SEO_KINDS)) kind: keyof typeof SEO_KINDS,
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: AdminActor,
  ) {
    return this.seo.autoGenerateAdminSeo(kind, id, actor);
  }

  @Post('redirects')
  createRedirect(@Body() dto: CreateRedirectDto, @Actor() actor: AdminActor) {
    return this.seo.createRedirect(dto, actor.id);
  }

  @Patch('redirects/:id')
  updateRedirect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRedirectDto,
    @Actor() actor: AdminActor,
  ) {
    return this.seo.updateRedirect(id, dto, actor.id);
  }

  @Post('seo/indexnow')
  indexNow(@Body() dto: IndexNowDto, @Actor() actor: AdminActor) {
    return this.seo.submitAdminIndexNow(dto, actor.id);
  }
}
