import { ShowcaseStatus } from '@app/database';

export class ShowcaseResponseDto {
  id!: string;
  slug!: string;
  title!: string;
  description!: string | null;
  status!: ShowcaseStatus;
  publishedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  ownerId?: string;
  linkedProductId?: string | null;
  linkedCategoryId?: string | null;
}
