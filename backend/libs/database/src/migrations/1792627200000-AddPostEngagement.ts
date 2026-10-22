import type { MigrationInterface, QueryRunner } from 'typeorm';

// Post engagement counters and per-voter like records.
//
// Counters live in post_engagement; individual votes live in post_likes.
// Both are updated asynchronously from Redis (see PostEngagementService), so a
// like/view click never writes synchronously to MySQL. All foreign keys are
// RESTRICT to prevent orphaned engagement rows; a post must have its
// engagement rows removed before it can be deleted.
export class AddPostEngagement1792627200000 implements MigrationInterface {
  name = 'AddPostEngagement1792627200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE post_engagement (
        post_id varchar(36) NOT NULL,
        likes_count int UNSIGNED NOT NULL DEFAULT 0,
        views_count int UNSIGNED NOT NULL DEFAULT 0,
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (post_id),
        CONSTRAINT fk_engagement_post FOREIGN KEY (post_id) REFERENCES showcases(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE post_likes (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        post_id varchar(36) NOT NULL,
        voter_id varchar(255) NOT NULL,
        voter_type enum('user','visitor') NOT NULL,
        UNIQUE INDEX uq_post_likes_post_voter (post_id, voter_id),
        INDEX idx_post_likes_post (post_id),
        PRIMARY KEY (id),
        CONSTRAINT fk_postlike_post FOREIGN KEY (post_id) REFERENCES showcases(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE post_likes');
    await queryRunner.query('DROP TABLE post_engagement');
  }
}
