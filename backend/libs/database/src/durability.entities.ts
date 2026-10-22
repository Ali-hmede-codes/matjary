import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { MediaAsset, Showcase } from './entities';

export interface ProcessingLimits {
  maxBytes: number;
  maxDurationSeconds: number;
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
}

@Entity({ name: 'media_processing_outbox', engine: 'InnoDB' })
export class MediaProcessingOutbox {
  @PrimaryColumn({ name: 'asset_id', type: 'varchar', length: 36 })
  assetId!: string;
  @ManyToOne(() => MediaAsset, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'asset_id',
    foreignKeyConstraintName: 'fk_media_outbox_asset',
  })
  asset!: Relation<MediaAsset>;
  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;
}

@Entity({ name: 'engagement_flush_receipts', engine: 'InnoDB' })
export class EngagementFlushReceipt {
  @PrimaryColumn({ name: 'batch_id', type: 'varchar', length: 36 })
  batchId!: string;
  @Column({ name: 'post_id', type: 'varchar', length: 36 }) postId!: string;
  @ManyToOne(() => Showcase, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'post_id',
    foreignKeyConstraintName: 'fk_engagement_receipt_post',
  })
  post!: Relation<Showcase>;
  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;
}
