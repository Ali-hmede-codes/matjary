import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Post,
  Body,
  Put,
  Delete,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SeoService, MetaTags, IndexNowUrl } from './seo.service';
import {
  StoreSeo,
  ProductSeo,
  ShowcaseSeo,
  SeoRedirect,
  SeoSettings,
} from './seo.entities';
import { SessionGuard } from '../auth/guards/auth.guards';

@ApiTags('SEO')
@Controller('seo')
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
    // Could implement filtered sitemap
    const xml = await this.seoService.generateSitemapXml();
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
    const xml = await this.seoService.generateSitemapXml();
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
    const xml = await this.seoService.generateSitemapXml();
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

  @Get('ai.txt')
  @Get('ai-robots.txt')
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
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit URLs to IndexNow for instant indexing' })
  @ApiResponse({ status: 200, description: 'IndexNow submission results' })
  async submitIndexNow(
    @Body() body: { urls: string[] },
  ): Promise<{ success: boolean; results: Record<string, boolean> }> {
    return this.seoService.submitToIndexNow(body.urls);
  }

  @Get('meta/store/:storeSlug')
  @ApiOperation({ summary: 'Get meta tags for a store page' })
  @ApiResponse({ status: 200, description: 'Meta tags for store' })
  async getStoreMetaTags(
    @Param('storeSlug') storeSlug: string,
  ): Promise<MetaTags | { error: string }> {
    return { error: 'Use store ID endpoint or implement store lookup' };
  }

  @Get('meta/product/:productSlug')
  @ApiOperation({ summary: 'Get meta tags for a product page' })
  @ApiResponse({ status: 200, description: 'Meta tags for product' })
  async getProductMetaTags(
    @Param('productSlug') productSlug: string,
  ): Promise<MetaTags | { error: string }> {
    return { error: 'Use product ID endpoint or implement product lookup' };
  }

  @Get('meta/post/:postSlug')
  @ApiOperation({ summary: 'Get meta tags for a post page' })
  @ApiResponse({ status: 200, description: 'Meta tags for post' })
  async getPostMetaTags(
    @Param('postSlug') postSlug: string,
  ): Promise<MetaTags | { error: string }> {
    return { error: 'Use showcase ID endpoint or implement showcase lookup' };
  }

  @Get('redirect/:fromPath(*)')
  @ApiOperation({ summary: 'Check if a redirect exists for a path' })
  @ApiResponse({ status: 200, description: 'Redirect target if exists' })
  async checkRedirect(@Param('fromPath') fromPath: string) {
    const redirect = await this.seoService.getRedirect(`/${fromPath}`);
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
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get global SEO settings' })
  async getSettings(): Promise<SeoSettings> {
    return this.seoService.getSettings();
  }

  @Put('settings')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update global SEO settings' })
  async updateSettings(
    @Body() data: Partial<SeoSettings>,
  ): Promise<SeoSettings> {
    return this.seoService.updateSettings(data);
  }

  // Store SEO
  @Get('stores/:storeId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get SEO for a store' })
  async getStoreSeo(
    @Param('storeId') storeId: string,
  ): Promise<StoreSeo | null> {
    return this.seoService.getStoreSeo(storeId);
  }

  @Put('stores/:storeId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create/update SEO for a store' })
  async upsertStoreSeo(
    @Param('storeId') storeId: string,
    @Body() data: Partial<StoreSeo>,
  ): Promise<StoreSeo> {
    return this.seoService.upsertStoreSeo(storeId, data);
  }

  @Post('stores/:storeId/auto-generate')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Auto-generate SEO for a store from its content' })
  async autoGenerateStoreSeo(
    @Param('storeId') storeId: string,
  ): Promise<StoreSeo> {
    // This would need store lookup - placeholder for integration
    return { error: 'Implement store lookup' } as any;
  }

  @Delete('stores/:storeId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete SEO for a store' })
  async deleteStoreSeo(@Param('storeId') storeId: string): Promise<void> {
    await this.seoService.deleteStoreSeo(storeId);
  }

  // Product SEO
  @Get('products/:productId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get SEO for a product' })
  async getProductSeo(
    @Param('productId') productId: string,
  ): Promise<ProductSeo | null> {
    return this.seoService.getProductSeo(productId);
  }

  @Put('products/:productId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create/update SEO for a product' })
  async upsertProductSeo(
    @Param('productId') productId: string,
    @Query('storeId') storeId: string,
    @Body() data: Partial<ProductSeo>,
  ): Promise<ProductSeo> {
    return this.seoService.upsertProductSeo(productId, storeId, data);
  }

  @Post('products/:productId/auto-generate')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Auto-generate SEO for a product from its content' })
  async autoGenerateProductSeo(
    @Param('productId') productId: string,
    @Query('storeId') storeId: string,
  ): Promise<ProductSeo> {
    return { error: 'Implement product/store lookup' } as any;
  }

  @Delete('products/:productId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete SEO for a product' })
  async deleteProductSeo(@Param('productId') productId: string): Promise<void> {
    await this.seoService.deleteProductSeo(productId);
  }

  // Showcase/Post SEO
  @Get('showcases/:showcaseId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get SEO for a showcase/post' })
  async getShowcaseSeo(
    @Param('showcaseId') showcaseId: string,
  ): Promise<ShowcaseSeo | null> {
    return this.seoService.getShowcaseSeo(showcaseId);
  }

  @Put('showcases/:showcaseId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create/update SEO for a showcase/post' })
  async upsertShowcaseSeo(
    @Param('showcaseId') showcaseId: string,
    @Query('storeId') storeId: string,
    @Body() data: Partial<ShowcaseSeo>,
  ): Promise<ShowcaseSeo> {
    return this.seoService.upsertShowcaseSeo(showcaseId, storeId, data);
  }

  @Post('showcases/:showcaseId/auto-generate')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Auto-generate SEO for a showcase/post from its content',
  })
  async autoGenerateShowcaseSeo(
    @Param('showcaseId') showcaseId: string,
    @Query('storeId') storeId: string,
  ): Promise<ShowcaseSeo> {
    return { error: 'Implement showcase/store lookup' } as any;
  }

  @Delete('showcases/:showcaseId')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete SEO for a showcase/post' })
  async deleteShowcaseSeo(
    @Param('showcaseId') showcaseId: string,
  ): Promise<void> {
    await this.seoService.deleteShowcaseSeo(showcaseId);
  }

  // Redirects
  @Get('redirects')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all redirects' })
  @ApiQuery({ name: 'storeId', required: false })
  async getRedirects(
    @Query('storeId') storeId?: string,
  ): Promise<SeoRedirect[]> {
    return this.seoService.getRedirects(storeId);
  }

  @Post('redirects')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new redirect' })
  async createRedirect(
    @Body() data: Partial<SeoRedirect>,
  ): Promise<SeoRedirect> {
    return this.seoService.createRedirect(data);
  }

  @Put('redirects/:id')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a redirect' })
  async updateRedirect(
    @Param('id') id: string,
    @Body() data: Partial<SeoRedirect>,
  ): Promise<SeoRedirect> {
    return this.seoService.updateRedirect(id, data);
  }

  @Delete('redirects/:id')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a redirect' })
  async deleteRedirect(@Param('id') id: string): Promise<void> {
    await this.seoService.deleteRedirect(id);
  }
}
