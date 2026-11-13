import type { MigrationInterface, QueryRunner } from 'typeorm';

// Two read paths on the public feed ran without a usable index:
//
// 1. Every personalised feed request asks "which posts did this viewer like?"
//    (category affinity and related-store feeds). `post_likes` was indexed
//    leading with `post_id`, so a voter-leading filter could only be answered
//    by scanning the whole table, once per viewer and cache miss.
// 2. A shop page and the favorites feed filter by `store_id` and order by
//    `published_at`. The existing `(store_id, created_at)` index forced a
//    filesort of the whole shop's history on every page.
//
// Each step is a single CREATE INDEX so a failed run leaves a small, inspectable
// delta. Both are pure read-path indexes; no data is rewritten.
export class FeedQueryIndexes1796251200000 implements MigrationInterface {
  name = 'FeedQueryIndexes1796251200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'CREATE INDEX `idx_post_likes_voter` ON `post_likes` (`voter_id`, `voter_type`)',
    );
    await runner.query(
      'CREATE INDEX `idx_showcases_store_published` ON `showcases` (`store_id`, `published_at`)',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP INDEX `idx_showcases_store_published` ON `showcases`',
    );
    await runner.query('DROP INDEX `idx_post_likes_voter` ON `post_likes`');
  }
}
