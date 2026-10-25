import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Req,
  Post,
  Body,
  Put,
  Delete,
  UseGuards,
  HttpStatus,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SeoService, MetaTags } from './seo.service';
import {
  StoreSeoDto,
  ProductSeoDto,
  ShowcaseSeoDto,
  SeoSettingsDto,
  CreateRedirectDto,
  UpdateRedirectDto,
  IndexNowDto,
} from './seo.dto';
import {
  StoreSeo,
  ProductSeo,
  ShowcaseSeo,
  SeoRedirect,
  SeoSettings,
} from './seo.entities';
import {
  SessionGuard,
  AdminGuard,
  MutationGuard,
} from '../auth/guards/auth.guards';
import type { AuthenticatedRequest } from '../auth/guards/auth.guards';

@ApiTags('SEO')
@Controller('seo')
@UseGuards(MutationGuard)
export class SeoController {
  constructor(private readonly seoService: SeoService) {}

  // ============================================
  // Public SEO Endpoints (no auth required)
  // ============================================

  @Get('sitemap.xml')
  @ApiOperation({ summary: 'Generate sitemap.xml' })
  @ApiResponse({
    status: 200,
    description: 'XML sitemap',
    content: { 'application/xml': {} },
  })
  async getSitemap(@Res() res: Response): Promise<void> {
    const xml = await this.seoService.generateSitemapXml();
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(xml);
  }

  @Get('sitemap-stores.xml')
  @ApiOperation({ summary: 'Generate stores-only sitemap.xml' })
  @ApiResponse({
    status: 200,
    description: 'XML sitemap for stores',
    content: { 'application/xml': {} },
  })
  async getStoresSitemap(@Res() res: Response): Promise<void> {
    const xml = await this.seoService.generateSitemapXml('store');
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  }

  @Get('sitemap-products.xml')
  @ApiOperation({ summary: 'Generate products-only sitemap.xml' })
  @ApiResponse({
    status: 200,
    description: 'XML sitemap for products',
    content: { 'application/xml': {} },
  })
  async getProductsSitemap(@Res() res: Response): Promise<void> {
    const xml = await this.seoService.generateSitemapXml('product');
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  }

  @Get('sitemap-posts.xml')
  @ApiOperation({ summary: 'Generate posts-only sitemap.xml' })
  @ApiResponse({
    status: 200,
    description: 'XML sitemap for posts',
    content: { 'application/xml': {} },
  })
  async getPostsSitemap(@Res() res: Response): Promise<void> {
    const xml = await this.seoService.generateSitemapXml('showcase');
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  }

  @Get('robots.txt')
  @ApiOperation({ summary: 'Generate robots.txt with AI crawler directives' })
  @ApiResponse({
    status: 200,
    description: 'Robots.txt',
    content: { 'text/plain': {} },
  })
  async getRobotsTxt(@Res() res: Response): Promise<void> {
    const txt = await this.seoService.generateRobotsTxt();
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(txt);
  }

  // ============================================
  // GEO / AI Optimization Endpoints (2026)
  // ============================================

  @Get('llms.txt')
  @ApiOperation({
    summary:
      'Generate llms.txt for AI crawlers (Generative Engine Optimization)',
  })
  @ApiResponse({
    status: 200,
    description: 'LLMs.txt content for AI understanding',
    content: { 'text/plain': {} },
  })
  async getLlmsTxt(@Res() res: Response): Promise<void> {
    const txt = await this.seoService.generateLlmsTxt();
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(txt);
  }

  @Get(['ai.txt', 'ai-robots.txt'])
  @ApiOperation({
    summary: 'Generate ai.txt / ai-robots.txt for AI crawler permissions',
  })
  @ApiResponse({
    status: 200,
    description:
      'AI robots.txt controlling AI crawler access and training permissions',
    content: { 'text/plain': {} },
  })
  async getAiRobotsTxt(@Res() res: Response): Promise<void> {
    const txt = await this.seoService.generateAiRobotsTxt();
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(txt);
  }

  @Post('indexnow')
  @UseGuards(SessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit URLs to IndexNow for instant indexing' })
  @ApiResponse({ status: 200, description: 'IndexNow submission results' })
  async submitIndexNow(
    @Body() body: IndexNowDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; results: Record<string, boolean> }> {
    return this.seoService.submitAdminIndexNow(body, req.user.id);
  }

  @Get('meta/store/:storeSlug')
  @ApiOperation({ summary: 'Get meta tags for a store page' })
  @ApiResponse({ status: 200, description: 'Meta tags for store' })
  async getStoreMetaTags(
    @Param('storeSlug') storeSlug: string,
  ): Promise<MetaTags | { error: string }> {
    return this.seoService.getMetaBySlug('store', storeSlug);
  }

  @Get('meta/product/:productSlug')
  @ApiOperation({ summary: 'Get meta tags for a product page' })
  @ApiResponse({ status: 200, description: 'Meta tags for product' })
  async getProductMetaTags(
    @Param('productSlug') productSlug: string,
    @Query('storeSlug') storeSlug?: string,
  ): Promise<MetaTags> {
    return this.seoService.getMetaBySlug('product', productSlug, storeSlug);
  }

  @Get('meta/post/:postSlug')
  @ApiOperation({ summary: 'Get meta tags for a post page' })
  @ApiResponse({ status: 200, description: 'Meta tags for post' })
  async getPostMetaTags(
    @Param('postSlug') postSlug: string,
  ): Promise<MetaTags | { error: string }> {
    return this.seoService.getMetaBySlug('showcase', postSlug);
  }

  @Get('og/:file')
  @ApiOperation({
    summary: 'Serve the auto-generated store share card image',
  })
  @ApiResponse({
    status: 200,
    description: 'JPEG share card',
    content: { 'image/jpeg': {} },
  })
  async getShareCard(
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    const slug = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.jpg$/u.exec(file)?.[1];
    const card = slug ? await this.seoService.openShareCard(slug) : undefined;
    if (!card) throw new NotFoundException('Image not found');
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Length', String(card.size));
    await pipeline(card.stream, res).catch(() => res.destroy());
  }

  @Get('share/{*path}')
  @ApiOperation({
    summary: 'Server-rendered Open Graph page for social link previews',
  })
  @ApiResponse({
    status: 200,
    description: 'Minimal HTML document with OG/Twitter tags',
    content: { 'text/html': {} },
  })
  async getSharePage(
    @Param('path') path: string | string[],
    @Req() request: Request,
    @Res() res: Response,
  ): Promise<void> {
    const target = Array.isArray(path) ? path.join('/') : (path ?? '');
    const html = await this.seoService.renderShareHtml(
      target,
      request.headers['user-agent'],
    );
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    // The preview URL is a sharing device; the clean storefront URL is canonical.
    res.set('X-Robots-Tag', 'noindex');
    res.send(html);
  }

  @Get('redirect/{*fromPath}')
  @ApiOperation({ summary: 'Check if a redirect exists for a path' })
  @ApiResponse({ status: 200, description: 'Redirect target if exists' })
  async checkRedirect(@Param('fromPath') fromPath?: string | string[]) {
    const path = Array.isArray(fromPath)
      ? fromPath.join('/')
      : (fromPath ?? '');
    const redirect = await this.seoService.getRedirect(
      `/${path.replace(/^\/+/, '')}`,
    );
    if (!redirect) {
      return { redirect: null };
    }
    return {
      redirect: { to: redirect.toPath, statusCode: redirect.statusCode },
    };
  }

  // ============================================
  // Admin/Protected Endpoints (require auth)
  // ============================================

  @Get('settings')
  @UseGuards(SessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get global SEO settings' })
  async getSettings(@Req() req: AuthenticatedRequest): Promise<SeoSettings> {
    return this.seoService.getAdminSettings(req.user.id);
  }

  @Put('settings')
  @UseGuards(SessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update global SEO settings' })
  async updateSettings(
    @Body() data: SeoSettingsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SeoSettings> {
    return this.seoService.updateSettings(data, req.user.id);
  }

  // Store SEO
  @Get('stores/:storeId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get SEO for a store' })
  async getStoreSeo(
    @Param('storeId') storeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.seoService.getOwnedSeo('store', storeId, req.user.id);
  }

  @Put('stores/:storeId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create/update SEO for a store' })
  async upsertStoreSeo(
    @Param('storeId') storeId: string,
    @Body() data: StoreSeoDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StoreSeo> {
    return this.seoService.upsertStoreSeo(storeId, data, req.user.id);
  }

  @Post('stores/:storeId/auto-generate')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Auto-generate SEO for a store from its content' })
  async autoGenerateStoreSeo(
    @Param('storeId') storeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.seoService.autoGenerateOwnedSeo('store', storeId, req.user.id);
  }

  @Delete('stores/:storeId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete SEO for a store' })
  async deleteStoreSeo(
    @Param('storeId') storeId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.seoService.deleteStoreSeo(storeId, req.user.id);
  }

  // Product SEO
  @Get('products/:productId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get SEO for a product' })
  async getProductSeo(
    @Param('productId') productId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.seoService.getOwnedSeo('product', productId, req.user.id);
  }

  @Put('products/:productId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create/update SEO for a product' })
  async upsertProductSeo(
    @Param('productId') productId: string,
    @Body() data: ProductSeoDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ProductSeo> {
    return this.seoService.upsertProductSeo(productId, data, req.user.id);
  }

  @Post('products/:productId/auto-generate')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Auto-generate SEO for a product from its content' })
  async autoGenerateProductSeo(
    @Param('productId') productId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.seoService.autoGenerateOwnedSeo(
      'product',
      productId,
      req.user.id,
    );
  }

  @Delete('products/:productId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete SEO for a product' })
  async deleteProductSeo(
    @Param('productId') productId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.seoService.deleteProductSeo(productId, req.user.id);
  }

  // Showcase/Post SEO
  @Get('showcases/:showcaseId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get SEO for a showcase/post' })
  async getShowcaseSeo(
    @Param('showcaseId') showcaseId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.seoService.getOwnedSeo('showcase', showcaseId, req.user.id);
  }

  @Put('showcases/:showcaseId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create/update SEO for a showcase/post' })
  async upsertShowcaseSeo(
    @Param('showcaseId') showcaseId: string,
    @Body() data: ShowcaseSeoDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ShowcaseSeo> {
    return this.seoService.upsertShowcaseSeo(showcaseId, data, req.user.id);
  }

  @Post('showcases/:showcaseId/auto-generate')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Auto-generate SEO for a showcase/post from its content',
  })
  async autoGenerateShowcaseSeo(
    @Param('showcaseId') showcaseId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.seoService.autoGenerateOwnedSeo(
      'showcase',
      showcaseId,
      req.user.id,
    );
  }

  @Delete('showcases/:showcaseId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete SEO for a showcase/post' })
  async deleteShowcaseSeo(
    @Param('showcaseId') showcaseId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.seoService.deleteShowcaseSeo(showcaseId, req.user.id);
  }

  // Redirects
  @Get('redirects')
  @UseGuards(SessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all redirects' })
  @ApiQuery({ name: 'storeId', required: false })
  async getRedirects(
    @Req() req: AuthenticatedRequest,
    @Query('storeId') storeId?: string,
  ): Promise<SeoRedirect[]> {
    return this.seoService.getRedirects(req.user.id, storeId);
  }

  @Post('redirects')
  @UseGuards(SessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new redirect' })
  async createRedirect(
    @Body() data: CreateRedirectDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SeoRedirect> {
    return this.seoService.createRedirect(data, req.user.id);
  }

  @Put('redirects/:id')
  @UseGuards(SessionGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a redirect' })
  async updateRedirect(
    @Param('id') id: string,
    @Body() data: UpdateRedirectDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SeoRedirect> {
    return this.seoService.updateRedirect(id, data, req.user.id);
  }

  @Delete('redirects/:id')
  @UseGuards(SessionGuard, AdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a redirect' })
  async deleteRedirect(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.seoService.deleteRedirect(id, req.user.id);
  }
}
