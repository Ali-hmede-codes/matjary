import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { UserDashboardService } from './user-dashboard.service';
import { DashboardSummaryDto } from './dto/dashboard-response.dto';
import { SessionGuard, AuthenticatedRequest } from '../auth/guards/auth.guards';

@Controller('dashboard')
export class UserDashboardController {
  constructor(private readonly dashboard: UserDashboardService) {}

  @Get()
  @UseGuards(SessionGuard)
  async getDashboard(
    @Req() request: AuthenticatedRequest,
  ): Promise<DashboardSummaryDto> {
    const userId = request.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.dashboard.getDashboard(userId);
  }

  @Get('stores')
  @UseGuards(SessionGuard)
  async getStores(@Req() request: AuthenticatedRequest) {
    const userId = request.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.dashboard.getUserStores(userId);
  }

  @Get('stores/:storeId')
  @UseGuards(SessionGuard)
  async getStore(
    @Param('storeId') storeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.dashboard.getUserStore(userId, storeId);
  }

  @Get('posts')
  @UseGuards(SessionGuard)
  async getPosts(
    @Req() request: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('storeId') storeId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('cursor') cursor?: string,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.dashboard.getUserPosts(userId, {
      status: status as any,
      storeId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      cursor,
    });
  }

  @Get('products')
  @UseGuards(SessionGuard)
  async getProducts(
    @Req() request: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('storeId') storeId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('cursor') cursor?: string,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.dashboard.getUserProducts(userId, {
      status: status as any,
      storeId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      cursor,
    });
  }

  @Get('showcases/:showcaseId/media')
  @UseGuards(SessionGuard)
  async getShowcaseMedia(
    @Param('showcaseId') showcaseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.dashboard.getShowcaseMedia(userId, showcaseId);
  }
}
